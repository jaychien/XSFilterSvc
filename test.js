/**
 * Created by Derek on 2014/9/23.
 */

var DOMParser = require('xmldom').DOMParser;

var xml = '';
xml = xml + '<Ret status="0">';
xml = xml + '<Symbol ID="2330.TW" Freq="8">';
xml = xml + '<Fields><![CDATA[收盤價;成交量;日期;開盤價;收盤價;最低價;最高價;成交量]]></Fields>';
xml = xml + '<Result />';
xml = xml + '<val value="71.1;35747;20110103;71.5;71.1;70.8;71.6;35747" />';
xml = xml + '<val value="71.2;36048;20110104;71;71.2;70.8;71.6;36048" />';
xml = xml + '</Symbol>';
xml = xml + '</Ret>';


var doc = new DOMParser().parseFromString(xml);

var status = doc.documentElement.getAttribute("status") || "0";
if (status != "0") {
    console.log("status=" + status);
}

var fieldNode = doc.documentElement.getElementsByTagName("Fields")[0];
var fields = fieldNode.childNodes[0].data;  // 收盤價;成交量;日期;開盤價;收盤價;最低價;最高價;..
console.log(fields);

var valNodeList = doc.documentElement.getElementsByTagName("val");
console.log(valNodeList.length);

