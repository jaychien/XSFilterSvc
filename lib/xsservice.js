/**
 * Created by Derek on 2014/9/23.
 */

var request = require('request');
var zlib = require('zlib');
var sprintf = require("sprintf-js").sprintf;
var DOMParser = require('xmldom').DOMParser;
var _ = require('underscore');
require('date-utils');

/*
    var xsxsv = new XSServiec({server:'http://sd-xsservice01:8083/'})
 */
var XSService = function(options) {

    var self = this;

    this.options = options || {};
    this.options.server = self.options.server || "http://sd-xsservice01:8083/";

    // 頻率
    //
    this.FREQ = {
        D:8,
        W:9,
        M:10,
        Q:14,
        H:15,
        Y:16
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
            url : this.options.server + url,
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
