from threading import Thread
import time
from ibapi.account_summary_tags import AccountSummaryTags

from config import logger
from connection import IBConnection, run_loop


def main():
    # Instantiate the connection
    app = IBConnection()
    
    try:
        # Connect using environment variables                                                       
        # host = IB_HOST if IB_HOST else "127.0.0.1"
        host = "127.0.0.1"
        port = 7497
        
        # Add retry logic for connection
        max_retries = 5
        retry_count = 0
        connected = False
        
        while retry_count < max_retries and not connected:
            try:
                logger.info(f"Connecting to {host}:{port} (Attempt {retry_count + 1}/{max_retries})")
                app.connect(host, port, clientId=0)
                
                # Start the application's event loop in a thread
                api_thread = Thread(target=run_loop, args=(app,), daemon=True)
                api_thread.start()
                
                # Wait until the connection is ready
                if app.connection_ready.wait(30):
                    connected = True
                    logger.info("Successfully connected to IB API")
                else: 
                    logger.warning("Connection timeout. Retrying...")
                    retry_count += 1
                    time.sleep(10)  # Wait before retry
            except Exception as e:
                logger.error(f"Connection error: {str(e)}")
                retry_count += 1
                time.sleep(10)  # Wait before retry
        
        if not connected:
            logger.error("Failed to connect after maximum retries. Exiting.")
            return
        
        # Request account summary
        logger.info("Requesting account summary")
        app.reqAccountSummary(0, "All", AccountSummaryTags.AllTags)
        
        # Keep the main thread running
        try:
            while True:
                if app.done.is_set():
                    break
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt detected. Shutting down...")
        
        # Disconnect
        app.disconnect()
        logger.info("Bot shutdown complete")
        
    except Exception as e:
        logger.error(f"Error in main function: {str(e)}")
        if app:
            app.disconnect()

if __name__ == "__main__":
    main()