# Automated checks

These tests open the app in a headless copy of Safari's engine (WebKit) using an iPhone 13 profile and a fake clock,
so timers can be checked in seconds. **This is not a real iPhone.** Sound, the silent switch, the real share sheet,
the screen-lock wake lock and Home Screen install can only be confirmed on a real phone.

To run them (needs Python 3, then `pip install playwright` and `playwright install webkit`):

1. Make a folder containing this repository under the name `Exercise-app`, and serve that folder:
   `python3 -m http.server 8765 --bind 127.0.0.1`
2. In another window: `python3 tests/test_app.py`
   (Settings you can change with environment variables: `BASE`, `MOUNT`, `SUBDIR`.)
