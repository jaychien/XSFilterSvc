/**
 * Created by Derek on 2014/9/24.
 */

var WebServer = require('./lib/webserver.js');
var options = require('./lib/config.json');

options = options || {};
options.port = options.port || 7001;

new WebServer(options.port).run();
