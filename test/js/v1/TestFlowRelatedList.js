describe("SDK Testing", function() {
	beforeAll(function(done) 
	{
		jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000;
		ZOHO.embeddedApp.on("PageLoad",function(data){
			console.log("------------------------------")
			console.log("on Load data")
			console.log("------------------------------")
			console.log(data)
			console.log("------------------------------")
			TestSpec.onLoadData = data
			done();
		})
		ZOHO.embeddedApp.init()
	});
	afterAll(testCompleted);
	/*
	 * Getch The Lead using the RecordID and verify its data
	 */
	it("get Current Record Info", function(done)
	{
		var onloadData = TestSpec.onLoadData;
		TestCases.getRecord(onloadData.Entity,onloadData.EntityId,function(result){
			expect(result).toBe(true);
			done();
		});
	});
	/*
	 * check resize
	 */
	it("UI resize", function(done)
	{
		TestCases.uiResize({width:100,height:200},function(result){
			expect(result).toBe(true);
			done();
		});
	});
});
