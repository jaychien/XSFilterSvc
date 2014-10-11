/**
 * Created by Derek on 2014/10/11.
 */

"use strict";

var Promise = require("bluebird");
var request = require('request');
var DOMParser = require('xmldom').DOMParser;
var sprintf = require("sprintf-js").sprintf;

var StockSvc = function() {

    /*
        查詢商品 with text (query)

        return a promise that resolve to
        { [ Id:'2330.TW', Name:'台積電' ], .. }

     */
    this.queryStock = function(query, count) {
        return new Promise(function(resolve, reject) {
            var url = sprintf('http://203.67.19.109/xqmdata/tradesymbolsearch.aspx?a=%s&b=tradesymbolselectstock&c=%d&type=XQM&encode=utf', query, count);
            request.get(url, function(err, response, body) {
                if (err != null) {
                    reject(err);
                }
                else if (response.statusCode != 200) {
                    reject('Server return statusCode=' + response.statusCode);
                }
                else {
                    try {
                        /*
                            <Result>
                                <Item ID='..' Name='..'/>
                            </Result>
                         */
                        var doc = new DOMParser().parseFromString(body);
                        var nodes = doc.documentElement.getElementsByTagName('Item');
                        var list = [];
                        for (var i = 0; i < nodes.length; i++) {
                            var node = nodes.item(i);
                            var id = node.getAttribute('ID').trim();
                            if (id.length == 7) {
                                // 濾掉代碼不是4碼 (9999.TW)的商品
                                //
                                list.push({ Id:id, 'Name':node.getAttribute('Name')});
                            }
                        }
                        resolve(list);
                    }
                    catch(err) {
                        reject('Parse result with error=' + err);
                    }
                }
            });
        });
    };

};

module.exports = StockSvc;
