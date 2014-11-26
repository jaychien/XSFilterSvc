/**
 * Created by Derek on 2014/9/24.
 */
"use strict";

var express = require('express');
var logger = require('./logger.js').getLogger('[web]');
var morgan = require('morgan');
var XSService = require('./xsservice.js');
var StockSvc = require('./stocksvc.js');
var _ = require('underscore');
_.str = require('underscore.string');
_.mixin(_.str.exports());

var Promise = require('bluebird');

var WebServer = function(options) {
    var self = this;

    self.options = options || {};
    self.options.xsserver = self.options.xsserver || 'http://203.67.19.128/xsservicetest/';

    if (!_(self.options.xsserver).endsWith('/'))
        self.options.xsserver = self.options.xsserver + '/';

    self.options.port = self.options.port || 7001;

    var app = express();

    var webFolder = __dirname + '/../web';

    app.use(express.static(webFolder));
    app.use(morgan('common'));

    this.run = function() {
        app.listen(self.options.port);
    };

    /*
        /api/getdata?server=..&symbol=2330.TW&freq=..&fields=..&count=..&fmt=..
        - freq = 8, 9, 10, ..
        - fields = comma-separated fields, e.g. "收盤價,成交金額"
        - count = 資料筆數, default=100
        - fmt = 'json'/'csv'/'table', default=json

        json 格式
        [
            [ 'date', 'value1', 'value2' ],
            [ 'date', 'value1', 'value2' ],
            ..
        ]

        csv 格式

        date,value1,value2
        date,value1,value2

        table格式

        <table>
          <tr><td>..</td><td>..</td></tr>
          <tr><td>..</td><td>..</td></tr>
        </table>

     */
    app.get('/api/getdata', function(req, res) {
        var server = req.param("server") || self.options.xsserver;
        if (!_(server).endsWith('/'))
            server = server + '/';
        var symbolID = req.param("symbol") || '';
        var freq = parseInt(req.param("freq")) || 0;
        var fields = req.param("fields") || '';
        var count = parseInt(req.param("count")) || 100;
        var fmt = req.param("fmt") || "json";
        if (symbolID == '' || freq == 0 || fields == '') {
            res.status(500).send('Invalid parameter.');
            return;
        }

        console.log('in getdata: fields=' + req.param("fields"));


        var xsservice = new XSService(server);
        xsservice.getHistData(symbolID, freq, fields, count)
            .then(function(result) {
                if (fmt.toLowerCase() == "csv") {
                    res.setHeader('Content-Type', 'text/csv');
                    res.status(200).send(formatCSV(result));
                }
                else if (fmt.toLowerCase() == "table") {
                    res.setHeader('Content-Type', 'text/html');
                    res.status(200).send(formatHtmlTable(result));
                }
                else {
                    // default json return
                    res.setHeader('Content-Type', 'application/json');
                    res.status(200).send(JSON.stringify(result));
                }
            })
            .catch(function(err) {
                res.status(500).send(err);
            });
    });

    /*
        /api/getfield?server=..

        Return field information
        [
            { Id: n, Field: 中文name, Aliases:[..], Freqs:[freq1, freq2] },
            ..
        ]

     */
    app.get('/api/getfield', function(req, res) {
        var server = req.param("server") || self.options.xsserver;
        if (!_(server).endsWith('/'))
            server = server + '/';

        var xsservice = new XSService(server);
        xsservice.getFieldData()
            .then(function(fields) {
                res.setHeader('Content-Type', 'application/json');
                res.status(200).send(JSON.stringify(fields));
            })
            .catch(function(err) {
                res.status(500).send(err);
            });
    });

    /*
        搜尋台股商品 by text

        /api/querystock?query=2330&count=..

        [ { Id: '2330.TW', Name: '台積電' }, .. ]
     */
    app.get('/api/querystock', function(req, res) {
        var query = req.param('query') || '';
        if (!query) {
            res.status(500).send('Missing query parameter');
            return;
        }
        var count = parseInt(req.param('count')) || 20;

        var stockSvc = new StockSvc();
        stockSvc.queryStock(query, count)
            .then(function(list) {
                res.setHeader('Content-Type', 'application/json');
                res.status(200).send(JSON.stringify(list));
            })
            .catch(function(err) {
                res.status(500).send(err);
            });
    });

    // global error handling
    //
    app.use(function(err, req, res, next) {
        logger.info('Error request[' + req.url + '] Err=[' + err.toString() + ']');
        logger.info(err.stack || '');

        res.status(500).send('Internal error occurred.');
    });

    function joinfields(array, separator) {
        return _.reduce(array, function(memo, item) {
            if (memo == '') {
                return item || '';
            }
            else {
                return memo + separator + (item || '');
            }
        }, '');
    }

    function formatCSV(result) {
        var lines = '';
        _.each(result, function(row) {
            lines = lines + joinfields(row, ',') + '\r\n';
        });

        return lines;
    }

    function formatHtmlTable(result) {
        var lines = '';
        lines = '<html><body><table>';
        _.each(result, function(row) {
            var tr = '<tr>';

            _.each(row, function(cell) {
                tr = tr + '<td>' + (cell || '&nbsp;') + '</td>';
            });

            tr = tr + '</tr>';
            lines = lines + tr;
        });
        lines = lines + '</table></body></html>'
        return lines;
    }
};

module.exports = WebServer;
