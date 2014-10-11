/**
 * Created by Derek on 2014/9/24.
 */

var WebServer = require('./lib/webserver.js');
var options = require('./lib/config.json');

options = options || {};
options.xsserver = options.xsserver || 'http://203.67.19.128/xsservicetest/';
options.port = options.port || 7001;

new WebServer(options).run();
