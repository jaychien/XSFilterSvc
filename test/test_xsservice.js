/**
 * Created by Derek on 2014/9/23.
 */

var XSService = require("../lib/xsservice.js");

var xsService = new XSService();

describe("XSService module", function() {

    // 測試正常欄位
    //
    it("test HistData query:單一欄位", function(done) {
        xsService.getHistData("2330.TW", xsService.FREQ.D, "收盤價", 10, function(err, result) {
            if (err != null)
                console.log(err);
            else
                console.log(result);
            done();
        });
    });

    // 測試正常欄位#2
    //
    it("test HistData query:兩個欄位", function(done) {
        xsService.getHistData("2330.TW", xsService.FREQ.D, "外資買賣超;成交金額", 10, function(err, result) {
            if (err != null)
                console.log(err);
            else
                console.log(result);
            done();
        });
    });

    // 測試不存在的欄位
    //
    it("test HistData query:一個不存在的欄位+一個正常欄位", function(done) {
        xsService.getHistData("2330.TW", xsService.FREQ.D, "外資買-賣超;成交金額", 10, function(err, result) {
            if (err != null)
                console.log(err);
            else
                console.log(result);
            done();
        });
    });
});
