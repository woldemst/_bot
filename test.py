from ibapi.client import EClient
from ibapi.wrapper import EWrapper

class TestApp(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
    
    def connectAck(self):
        print(f"Connected to TWS API version: {self.serverVersion()}")
        self.disconnect()

app = TestApp()
app.connect("127.0.0.1", 7497, 0)  # Use your port number
app.run()