/**
 * Created by Derek on 2014/9/23.
 */
"use strict";

var request = require('request');
var zlib = require('zlib');
var sprintf = require("sprintf-js").sprintf;
var DOMParser = require('xmldom').DOMParser;
var _ = require('underscore');
require('date-utils');
var Promise = require("bluebird");

/*
    var xsxsv = new XSServiec('http://sd-xsservice01:8083/')
 */
var XSService = function(server) {

    var self = this;

    self.server = server;

    // 頻率
    //
    this.FREQ = {
        D:8,
        W:9,
        M:10,
        AD:11,
        AW:12,
        AM:13,
        Q:14,
        H:15,
        Y:16
    };

    // Helper object to issue XS XML request
    //
    var XSRequest = function() {
        var self = this;

        self.requestAsync = Promise.promisify(request);
        self.gunzipAsync = Promise.promisify(zlib.gunzip, zlib);
        self.inflateAsync = Promise.promisify(zlib.inflate, zlib);

        self.decodeResponseBuffer = function(response, body) {
            return new Promise(function(resolve, reject) {
                var encoding = response.headers['content-encoding'];
                if (encoding == 'gzip') {
                    resolve(self.gunzipAsync(body));
                }
                else if (encoding == 'deflate') {
                    resolve(self.inflateAsync(body));
                }
                else {
                    resolve(body);
                }
            });
        };

        // Perform a XS request (with xml data), and return a promise that resolve to the xml DOM document
        //
        self.postXmlRequst = function(url, version, actionCode, postXml) {
            var postData = generateRequestBody(version, actionCode, postXml);
            var options = {
                url : url,
                method : 'POST',
                headers : {
                    'Content-Length' : postData.length,
                    'Content-Type' : 'application/octet-stream'
                },
                body: postData,
                encoding: null
            };
            return self.requestAsync(options)
                .spread(function(response, body) {
                    return self.decodeResponseBuffer(response, body);
                })
                .then(function(buffer) {
                    return parseXmlResult(buffer.toString('utf-8'));
                })
        };

        // Perform a get request, and return a promise
        // that resolves to the http response text (utf-8)
        //
        self.sendGetRequest = function(url) {
            var options = {
                url : url,
                method: 'GET',
                headers : {
                    'Accept-Encoding' : 'gzip'
                },
                encoding: null
            };
            return self.requestAsync(options)
                .spread(function(response, body) {
                    return self.decodeResponseBuffer(response, body);
                })
                .then(function(buffer) {
                    return buffer.toString('utf-8');
                })
        };

        function parseXmlResult(xml) {
            /*
                 <Ret status="0">
                    ...
                 </Ret>
             */
            var doc = new DOMParser().parseFromString(xml);

            var status = doc.documentElement.getAttribute("status") || "0";
            if (status != "0")
                throw 'Xml Ret status = ' + status;
            else
                return doc;
        }

        function generateRequestBody(version, action, content) {
            var contentBuf = new Buffer(content, 'utf8');
            var frame = new Buffer(8);
            frame.writeInt32LE(contentBuf.length + 4, 0);
            frame.writeInt16LE(version, 4);
            frame.writeInt16LE(action, 6);
            return Buffer.concat([frame, contentBuf]);
        }
    };

    /*
        symbolID = '2330.TW'
        freq = FREQ, e.g. this.FREQ.D
        fields = array of 欄位,
        count = 資料筆數

        Return a promise, that resolve to
            [ [date, value1, value2], [date, value1, value2], .. ]
            - 每一筆有n個value, 如果無資料則回null
            - date為 yyyyMMdd (string)
            - 最新的放在最前面
     */
    this.getHistData = function(symbolID, freq, fields, count) {
        var url = 'SymbolData.html';
        var version = 1;
        var actionCode = 3;

        if (!Array.isArray(fields))
            fields = fields.split(";");

        var postXml = composeHistDataRequestXml(symbolID, freq, fields, count);
        return new XSRequest().postXmlRequst(self.server + url, version, actionCode, postXml)
            .then(function(doc) {
                return parseHistData(doc, fields, count);
            });
    };

    /*
        Query field information
        return a promise that resolve to
            fields =
            [
                { Id: n, Field: 中文name, Aliases:[..], Freqs:[freq1, freq2] },
                ..
            ]
     */
    this.getFieldData = function() {
        return new XSRequest().sendGetRequest(self.server + 'js/Fields.js')
            .then(JSON.parse)
            .then(function(fields) {
                /*
                    Source Format:

                    [ { Names: [ "Volume", "成交量" ],
                        Id: 9,
                        Categ: [ 1, 2 ],
                        Desc: "每個時段區間的交易量累計加總",
                        ScriptTypes: [ 1, 2, 3, 4, 5, 6 ],
                        Freqs: [ 8, 9, 10, 14, 16 ]
                      },
                    ]

                    Target Format:

                    { Id: n, Field: 中文name, Aliases:[..], Freqs:[freq1, freq2] }
                */
                var output = [];
                var uniqueMap = {};
                _.each(fields, function(field) {
                    if (field.Freqs && field.Freqs.length > 0 && field.Names && field.Names.length > 0) {
                        var chName = field.Names[field.Names.length - 1];

                        if (!uniqueMap[field.Id]) {
                            uniqueMap[field.Id] = chName;
                            var aliases = field.Names.slice(0, field.Names.length - 1);
                            output.push({Id: field.Id, Field: chName, Aliases: aliases, Freqs: field.Freqs});
                        }
                    }
                });
                return output;
            });
    };

    function parseHistData(doc, fields, count) {
        /*
            <Ret status="0">
                <Symbol ID="2330.TW" Freq="8">
                    <Fields><![CDATA[收盤價;成交量;日期;開盤價;收盤價;最低價;最高價;成交量]]></Fields>
                    <Result />
                    <val value="71.1;35747;20110103;71.5;71.1;70.8;71.6;35747" />
                    <val value="71.2;36048;20110104;71;71.2;70.8;71.6;36048" />
                </Symbol>
            </Ret>
        */
        var fieldNode = doc.documentElement.getElementsByTagName("Fields")[0];

        var returnFields = ['日期'].concat(fields);
        var fieldIndexList = mapReturnFieldIndex(fieldNode.childNodes[0].data, returnFields);

        var valNodeList = doc.documentElement.getElementsByTagName("val");

        var dataList = [];

        for (var i = 0; i < valNodeList.length; i++) {
            var node = valNodeList.item(i);
            var values = node.getAttribute('value');
            dataList.push(parseNodeValue(values, fieldIndexList));
        }

        // 取前面 count 筆
        //
        var dataList2 = [];
        for (i = dataList.length - 1; i >= 0 && dataList2.length < count; i--) {
            dataList2.push(dataList[i]);
        }

        return dataList2;
    }

    function composeHistDataRequestXml(symbolID, freq, fields, count) {
        /*
            <?xml version='1.0' encoding='utf-8' ?>
            <Symbol ID='2330.TW' Freq='8' Fields='收盤價;成交量'/>
        */
        var xml = '';

        xml = xml + '<?xml version="1.0" encoding="UTF-8"?>';
        xml = xml + sprintf("<Symbol ID='%s' Freq='%d' Fields='%s'/>", symbolID, freq, getFieldList(fields));
        return xml;
    }

    function getFieldList(fields) {
        return _.reduce(fields, function(x, field) {
            if (x == '')
                return field;
            else
                return x + ';' + field;
        }, '');
    }

    // fieldString是server回的資料的欄位名稱, e.g. 收盤價;成交量;日期;開盤價;收盤價;最低價;最高價;..
    // fields是我們呼叫時希望取得的欄位list
    // return [ 0, 1, .. ]
    //  找出我們希望取得的欄位在資料內的0-based index
    //
    function mapReturnFieldIndex(fieldsString, fields) {
        var retFields = fieldsString.split(';');

        var indexList = [];
        _.each(fields, function(field) {
            indexList.push(_.indexOf(retFields, field));
        });
        return indexList;
    }

    // values是每一筆資料 <value1>;<value2>;<value3>..
    // fieldIndexList是要取得的欄位的0-based index的位置
    // return [ <value1>, <value2>, null, .. ]
    //
    function parseNodeValue(values, fieldIndexList) {
        var valueArray = values.split(';');

        return _.map(fieldIndexList, function(fieldIndex, index) {
            if (fieldIndex < 0) {
                return null;
            }
            else if (fieldIndex >= valueArray.length) {
                return null;
            }
            else {
                var value = valueArray[fieldIndex];
                if (index == 0) {
                    // TODO: convert to date
                    //
                }
                return value;
            }
        });
    }
};

module.exports = XSService;
