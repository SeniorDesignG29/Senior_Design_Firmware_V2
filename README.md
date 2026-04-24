# 💊 Scooby Snack — Automated Medication Dispenser
### SMDG29 | University of Illinois Chicago | Senior Design Capstone

A smart, voice-enabled automated medication dispenser for elderly users. The system combines an ESP32-based hardware dispenser with a cross-platform mobile app (iOS, Android, Web) to schedule, dispense, and track medication while notifying caregivers in real time.

---

## 📸 System Overview

```
┌─────────────────────────────────────────────────────┐
│                   Scooby Snack System               │
│                                                     │
│   ┌──────────────┐         ┌────────────────────┐   │
│   │   Mobile App │  WiFi   │  ESP32 Hardware    │   │
│   │  iOS/Android │◄──────► │  Dispenser Unit    │   │
│   │     Web      │         │                    │   │
│   └──────────────┘         └────────────────────┘   │
│          │                          │               │
│          ▼                          ▼               │
│   ┌─────────────┐         ┌────────────────────┐    │
│   │  Pushover   │         │  Peristaltic Pump  │    │
│   │  Caregiver  │         │  Stepper Motor     │    │
│   │  Alerts     │         │  IR Sensor         │    │
│   └─────────────┘         │  OLED Display      │    │
│                           │  DS3231 RTC        │    │
│                           └────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## ✨ Features

### Hardware
- Star-wheel mechanism with Nema 17 stepper motor (TB6600 driver)
- DS3231 RTC for precise medication scheduling
- SH1107 128×128 OLED display showing patient name, medication, and next dose time
- INTLLAB peristaltic pump for liquid medication delivery
- GP2A200LCS0F IR reflective sensor for pill detection and logging
- XY-MOS MOSFET module for pump control
- WiFi web server for app communication

### Mobile App
- Cross-platform: iOS, Android, and Web
- Voice feedback using ElevenLabs TTS (4 voice personality profiles)
- Medication scheduling with custom time picker
- Adherence tracking and streak counter
- Pushover push notifications to caregivers when medication is taken or missed
- Automatic RTC sync from phone time on every connection

---

## 🛠 Hardware Components

| Component | Model | Purpose |
|-----------|-------|---------|
| Microcontroller | ESP32 DevKit | WiFi, web server, control logic |
| Stepper Motor | Nema 17 | Star-wheel carousel rotation |
| Motor Driver | TB6600 | Stepper control |
| RTC | DS3231 | Scheduled dispensing |
| Display | HiLetgo SH1107 128×128 | Status display |
| Pump | INTLLAB DP-DIY Peristaltic | Liquid delivery |
| MOSFET | XY-MOS | Pump switching |
| IR Sensor | GP2A200LCS0F | Pill detection |

---

## 🔌 Hardware Wiring

### TB6600 Stepper Driver
```
PUL+ → ESP32 GPIO 14
PUL− → ESP32 GND
DIR+ → ESP32 GPIO 27
DIR− → ESP32 GND
ENA+ → ESP32 5V
ENA− → ESP32 GND
```

**DIP Switch Settings (1.0A / 200 steps/rev):**
```
SW1 ON  SW2 ON  SW3 OFF  SW4 ON  SW5 OFF  SW6 ON
```

### DS3231 RTC
```
VCC → ESP32 3.3V
GND → ESP32 GND
SDA → ESP32 GPIO 21
SCL → ESP32 GPIO 22
```

### SH1107 OLED (128×128)
```
VCC → ESP32 3.3V
GND → ESP32 GND
SDA → ESP32 GPIO 21
SCL → ESP32 GPIO 22
I2C Address: 0x3C
```

### XY-MOS MOSFET (Pump)
```
IN  → ESP32 GPIO 25
GND → ESP32 GND
V+  → 12V Supply (+)
V−  → 12V Supply (−) + ESP32 GND (shared)
OUT+ → Pump (+)
OUT− → Pump (−)
```

### GP2A200LCS0F IR Sensor
```
VCC → ESP32 5V
GND → ESP32 GND
OUT → 10kΩ to 3.3V → ESP32 GPIO 34
```
⚠️ The 10kΩ pull-up resistor is required. Sensor is active LOW.

---

## 🚀 Firmware Setup (PlatformIO)

### Prerequisites
- VS Code with PlatformIO extension
- ESP32 board package

### Installation

1. Open the `firmware/` folder in PlatformIO
2. Update WiFi credentials in `main.cpp`:
```cpp
const char* ssid     = "YourNetworkName";
const char* password = "YourPassword";
```
3. Update Pushover credentials:
```cpp
const char* PUSHOVER_TOKEN = "your_app_token";
const char* PUSHOVER_USER  = "your_user_key";
```
4. Flash:
```bash
pio run --target upload
```
5. Monitor:
```bash
pio device monitor --baud 115200
```

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/takeNow` | GET | Trigger manual dispense |
| `/api/update` | POST | Sync schedule, RTC, and medication info |
| `/api/status` | GET | Read current state |

---

## 📱 Mobile App Setup (Expo)

### Prerequisites
- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- EAS CLI (`npm install -g eas-cli`)

### Installation

```bash
cd pill-dispenser-app
npm install
npx expo install react-dom react-native-web
```

### Environment Variables

Create a `.env` file in the app root:
```
EXPO_PUBLIC_ELEVENLABS_API_KEY=your_elevenlabs_key
EXPO_PUBLIC_PUSHOVER_TOKEN=your_pushover_app_token
EXPO_PUBLIC_PUSHOVER_USER=your_pushover_user_key
```

### Update ESP32 IP

In `App.js`, update the IP to match your ESP32:
```javascript
const ESP32_IP = '192.168.x.x'; // check Serial Monitor on boot
```

### Run in Development
```bash
npx expo start           # local network
npx expo start --tunnel  # for iOS via Expo Go on any network
```

### Build Android APK
```bash
eas build --platform android --profile preview
```
Generates a QR code for direct APK installation. No Play Store needed.

### Build Web
```bash
npx expo export --platform web
# Deploy dist/ folder to Netlify or Vercel
```

### iOS Without Apple Developer Account
Install **Expo Go** from the App Store, then run `npx expo start --tunnel` and scan the QR code with the iPhone camera.

---

## 📲 Notifications (Pushover)

The system sends push notifications via [Pushover](https://pushover.net):

| Event | Trigger | Message |
|-------|---------|---------|
| ✅ Medication Taken | User presses Take Now | "[Name] has taken their [Med] at [Time]" |
| ⚠️ Medication Missed | ESP32 auto-dispenses | "[Name] missed their [Med]. Dispenser released automatically." |

### Setup
1. Create account at pushover.net
2. Create an application → copy **API Token**
3. Copy your **User Key** from the dashboard
4. Install Pushover app on caregiver's phone
5. Add credentials to `.env` (app) and `main.cpp` (firmware)

---

## 🌐 Live Web App

The web version is deployed at:
**https://scoobysnack.netlify.app**

---

## 🗂 Project Structure

```
SMDG29/
├── firmware/
│   ├── platformio.ini
│   └── src/
│       └── main.cpp          # ESP32 firmware
│
└── pill-dispenser-app/
    ├── App.js                # Main React Native app (single file)
    ├── app.json              # Expo config
    ├── eas.json              # EAS Build config
    ├── .env                  # API keys (not committed)
    └── assets/
        └── splash.png        # App icon and splash screen
```

---

## 🔧 Troubleshooting

### ESP32 — WiFi Not Connecting
- ESP32 only supports **2.4GHz** — ensure your hotspot/router is broadcasting 2.4GHz
- Verify SSID and password match exactly (case-sensitive)
- Run the network scanner sketch to confirm the ESP32 can see the network
- If using a phone hotspot, a different phone must run the app (a phone cannot connect to its own hotspot)

### ESP32 — I2C Error -1 (Wire.cpp)
- Check SDA/SCL wiring on both the RTC and OLED
- Ensure both devices share the same GND as the ESP32
- Run I2C scanner to confirm device addresses

### App — Cannot Connect to Dispenser
- Phone and ESP32 must be on the **same WiFi network**
- Confirm `ESP32_IP` in `App.js` matches the IP shown in Serial Monitor on boot
- Ensure `usesCleartextTraffic: true` is set in `app.json` for Android

### App — Voice Not Working
- Confirm `EXPO_PUBLIC_ELEVENLABS_API_KEY` is set in `.env`
- Restart Expo with `npx expo start --clear`
- Check Expo logs for `[Voice] API error:`

### Motor Not Moving
- Verify PUL+/PUL− and DIR+/DIR− are not swapped
- Check TB6600 DIP switches match the current setting above
- Confirm ESP32 GND and 12V supply (−) are tied together

---

## 👥 Team

**SMDG29 — University of Illinois Chicago**
Senior Design Capstone Project

---

## ⚠️ Disclaimer

Scooby Snack is a senior design prototype intended for demonstration purposes. It is not a certified medical device and should not be used as a substitute for professional medical guidance or supervision.
