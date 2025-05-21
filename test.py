
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
import threading
import time

class TestApp(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)

    def nextValidId(self, orderId):
        self.orderId = orderId
        # print(f"Received next valid order ID: {self.orderId}")
    
    def nextId(self):
        self.orderId += 1
        return self.orderId

    def contractDetails(self, reqId, contractDetails):
        attrs = vars(contractDetails)
        print("\n".join(f"(name): {value})" for name, value in attrs.items()))
        print(contractDetails.contract)

    def contractDetailsEnd(self, reqid):
        print ("End of contract details")
        self.disconnect()

app = TestApp()
app.connect("127.0.0.1", 7497, 0)
threading.Thread(target=app.run).start()
time.sleep(1)  # Wait for nextValidId to be received

# for i in range(5):
#     print(app.printEWrapperData())
#     time.sleep(0.1)

myContract = Contract()
myContract.symbol = "SPX"
myContract.secType = "OPT"
myContract.currency = "USD"
myContract.exchange = "CBOE"
myContract.lastTradeDateOrContractMonth = "20240621"  # Expiry in YYYYMMDD
myContract.right = "P"
myContract.tradingClass = "SPX"
myContract.strike = 5300.0

app.reqContractDetails(app.nextId(), myContract)