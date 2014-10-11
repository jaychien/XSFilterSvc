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

        // Helper function to parse http response from 'request' module
        //  cb(err, responseBuffer)
        //
        self.decodeResponseBuffer = function(err, response, body, cb) {
            if (err != null) {
                cb(err);
            }
            else if (response.statusCode < 200 || response.statusCode > 299) {
                cb('server return http status:' + response.statusCode);
            }
            else {
                var encoding = response.headers['content-encoding'];
                if (encoding == 'gzip') {
                    zlib.gunzip(body, cb);
                }
                else if (encoding == 'deflate') {
                    zlib.inflate(body, cb);
                }
                else {
                    cb(null, body);
                }
            }
        };

        // cb(error, doc)
        //  - 執行成功後會parse回傳的xml, 檢查status code, 如果都成功的話, doc是parsed後的xml dom
        //
        self.sendXmlRequst = function(url, version, actionCode, postXml, cb) {
            var postData = generateRequestBody(version, actionCode, postXml);

            var options = {
                url : url,
                headers : {
                    'Content-Length' : postData.length,
                    'Content-Type' : 'application/octet-stream'
                },
                body: postData,
                encoding: null
            };

            request.post(options, function(err, response, body) {
                self.decodeResponseBuffer(err, response, body, function(err, buffer) {
                    if (err != null) {
                        cb(err);
                    }
                    else {
                        parseXmlResult(buffer.toString('utf-8'), cb);
                    }
                });
            });
        };

        // cb(error, result)
        //
        self.sendGetRequest = function(url, cb) {
            var options = {
                url : url,
                encoding: null
            };

            request.get(options, function(err, response, body) {
                self.decodeResponseBuffer(err, response, body, function(err, buffer) {
                    if (err != null) {
                        cb(err);
                    }
                    else {
                        cb(null, buffer.toString('utf-8'));
                    }
                });
            });
        };

        function parseXmlResult(xml, cb) {
            /*
             <Ret status="0">
                ...
             </Ret>
             */
            try {
                var doc = new DOMParser().parseFromString(xml);

                var status = doc.documentElement.getAttribute("status") || "0";
                if (status != "0")
                    cb('Xml Ret status = ' + status);
                else
                    cb(null, doc);
            }
            catch(err) {
                cb(err);
            }
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

        執行完成後呼叫 cb(err, result)
            result = [ [date, value1, value2], [date, value1, value2], .. ]
            - 每一筆有n個value, 如果無資料則回null
            - date為 yyyyMMdd (string)
            - 最新的放在最前面
     */
    this.getHistData = function(symbolID, freq, fields, count, cb) {
        var url = 'SymbolData.html';
        var version = 1;
        var actionCode = 3;

        if (!Array.isArray(fields))
            fields = fields.split(";");

        var postXml = composeHistDataRequestXml(symbolID, freq, fields, count);
        var postData = generateRequestBody(version, actionCode, postXml);

        var options = {
            url : self.server + url,
            headers : {
                'Content-Length' : postData.length,
                'Content-Type' : 'application/octet-stream'
            },
            body: postData
        };

        var req = request.post(options);

        req.on('response', function(res) {
            var chunks = [];
            res.on('data', function(chunk) {
                chunks.push(chunk);
            });

            res.on('end', function() {
                var buffer = Buffer.concat(chunks);
                var encoding = res.headers['content-encoding'];
                if (encoding == 'gzip') {
                    zlib.gunzip(buffer, function(err, decoded) {
                        if (err != null) {
                            cb(err, null);
                        }
                        else {
                            parseHistDataResult(fields, count, decoded && decoded.toString(), cb);
                        }
                    });
                } else if (encoding == 'deflate') {
                    zlib.inflate(buffer, function(err, decoded) {
                        if (err != null) {
                            cb(err, null);
                        }
                        else {
                            parseHistDataResult(fields, count, decoded && decoded.toString(), cb);
                        }
                    })
                } else {
                    parseHistDataResult(fields, count, buffer.toString(), cb);
                }
            });
        });

        req.on('error', function(err) {
            cb(err, null);
        });
    };

    // TODO: 需要驗證, 目前server怪怪的
    //
    this.getHistData_v2 = function(symbolID, freq, fields, count, cb) {
        var url = 'SymbolData.html';
        var version = 1;
        var actionCode = 3;

        if (!Array.isArray(fields))
            fields = fields.split(";");

        var postXml = composeHistDataRequestXml(symbolID, freq, fields, count);

        var xsrequest = new XSRequest();
        xsrequest.sendXmlRequst(self.server + url, version, actionCode, postXml, function(err, doc) {
            if (err != null) {
                cb(err);
            }
            else {
                parseHistDataResult_v2(doc, fields, count, cb);
            }
        });
    };

    /*
        Query field information
        cb(err, fields)

        fields =
        [
            { Id: n, Field: 中文name, Aliases:[..], Freqs:[freq1, freq2] },
            ..
        ]
     */
    this.getFieldData = function(cb) {
        var xsrequest = new XSRequest();
        xsrequest.sendGetRequest(self.server + 'js/Fields.js', function(err, result) {
            if (err != null) {
                cb(err);
            }
            else {
                var fields = JSON.parse(result);
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
                cb(null, output);
            }
        });
    };

    function parseHistDataResult_v2(doc, fields, count, cb) {
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

        cb(null, dataList2);
    }

    function parseHistDataResult(fields, count, xml, cb) {
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
        try {
            var doc = new DOMParser().parseFromString(xml);

            var status = doc.documentElement.getAttribute("status") || "0";
            if (status != "0")
                throw "Ret status = " + status;

            var fieldNode = doc.documentElement.getElementsByTagName("Fields")[0];

            var returnFields = ['日期'].concat(fields);
            var fieldIndexList = mapReturnFieldIndex(fieldNode.childNodes[0].data, returnFields);

            var valNodeList = doc.documentElement.getElementsByTagName("val");

            var dataList = [];
            var i;

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

            cb(null, dataList2);
        }
        catch(err) {
            cb(err, null);
        }
    }

    function generateRequestBody(version, action, content) {
        var contentBuf = new Buffer(content, 'utf8');
        var frame = new Buffer(8);
        frame.writeInt32LE(contentBuf.length + 4, 0);
        frame.writeInt16LE(version, 4);
        frame.writeInt16LE(action, 6);
        return Buffer.concat([frame, contentBuf]);
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

    function parseHistDataResult(fields, count, xml, cb) {
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

        console.log(xml);
        try {
            var doc = new DOMParser().parseFromString(xml);

            var status = doc.documentElement.getAttribute("status") || "0";
            if (status != "0")
                throw "Ret status = " + status;

            var fieldNode = doc.documentElement.getElementsByTagName("Fields")[0];

            var returnFields = ['日期'].concat(fields);
            var fieldIndexList = mapReturnFieldIndex(fieldNode.childNodes[0].data, returnFields);

            var valNodeList = doc.documentElement.getElementsByTagName("val");

            var dataList = [];
            var i;

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

            cb(null, dataList2);
        }
        catch(err) {
            cb(err, null);
        }
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
