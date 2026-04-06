/*
 * SCOOBY SNACK - Automated Medication Dispenser
 * UIC Senior Design Project (SMDG29)
 * 
 * Hardware:
 * - ESP32 (OSOYOO 38P Terminal Shield)
 * - TMC2209 V1.3 Stepper Driver (Star Wheel)
 * - STEPPERONLINE Nema 17 Motor
 * - HiLetgo SH1107 128x128 OLED Display (I2C)
 * - DS3231 RTC Module
 * - 12V Peristaltic Pump (Liquid Medication)
 * - Hall Effect Sensor (A3144 - Homing)
 * - IR Reflective Sensor (TCRT5000 - Pill Detection)
 * - Passive Buzzer (Alerts)
 * - 12V Barrel Jack Power
 * 
 * Features:
 * - Star wheel pill dispenser (2-week capacity)
 * - Liquid medication pump with precise dose control
 * - Automatic homing with Hall sensor
 * - Pill detection verification
 * - RTC-based scheduling
 * - BLE mobile app control
 * - WiFi web dashboard
 * - Audio/visual alerts
 * - Low medication warnings
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <RTClib.h>
#include <WiFi.h>
#include <WebServer.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>


// ======================================
// FORWARD DECLARATIONS
// ======================================
void handleBLECommand(String command);
void updateDisplay();
void playMelody(int melody);

// ======================================
// PIN DEFINITIONS
// ======================================

// Stepper Motor (TMC2209 - Star Wheel)
#define STEP_PIN        26
#define DIR_PIN         25
#define EN_PIN          33

// Peristaltic Pump (PWM Control)
#define PUMP_PIN        27

// Sensors
#define HALL_SENSOR_PIN 14    // Homing sensor (active LOW)
#define IR_SENSOR_PIN   13    // Pill detection (active LOW)

// Buzzer
#define BUZZER_PIN      12

// OLED Display (I2C)
#define OLED_SDA        21
#define OLED_SCL        22
#define OLED_RESET      -1    // No reset pin

// ======================================
// HARDWARE CONFIGURATION
// ======================================

// Star Wheel Parameters
#define POCKETS_PER_REVOLUTION  14      // 2 weeks of pills
#define STEPS_PER_REV           200     // Nema 17: 1.8° per step
#define MICROSTEPS              16      // TMC2209 microstepping
#define STEPS_PER_POCKET        ((STEPS_PER_REV * MICROSTEPS) / POCKETS_PER_REVOLUTION)

// Pump Calibration (from test data - 180 mL/min at 12V)
#define PUMP_ML_PER_SECOND      3.0     
#define PUMP_PWM_FREQUENCY      1000    
#define PUMP_PWM_CHANNEL        0
#define PUMP_PWM_RESOLUTION     8       

// System Limits
#define MAX_PILLS_CAPACITY      14      
#define MAX_SCHEDULES           10

// ======================================
// GLOBAL OBJECTS
// ======================================

Adafruit_SH1107 display(128, 128, &Wire, OLED_RESET);
RTC_DS3231 rtc;
Preferences preferences;
WebServer server(80);

// BLE
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;

// ======================================
// SYSTEM STATE
// ======================================

struct SystemState {
    int currentPocket = 0;
    int pillsRemaining = MAX_PILLS_CAPACITY;
    bool homed = false;
    bool pumpEnabled = true;
    DateTime lastDispense;
    uint32_t totalPillsDispensed = 0;
    uint32_t totalLiquidDispensed = 0;  
};

SystemState state;

struct MedicationSchedule {
    bool enabled;
    uint8_t hour;
    uint8_t minute;
    bool pillEnabled;
    bool liquidEnabled;
    float liquidDose_mL;
    bool daysOfWeek[7];  
};

MedicationSchedule schedules[MAX_SCHEDULES];

// ======================================
// BLE CONFIGURATION
// ======================================

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_UUID           "beb5483e-36e1-4688-b7f5-ea07361b26a8"

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        deviceConnected = true;
        Serial.println("BLE Client Connected");
    }
    
    void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
        Serial.println("BLE Client Disconnected");
        BLEDevice::startAdvertising();
    }
};

class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        std::string value = pCharacteristic->getValue();
        if (value.length() > 0) {
            String command = String(value.c_str());
            handleBLECommand(command);
        }
    }
};

// Forward declarations
void handleBLECommand(String command);
void updateDisplay();
void playMelody(int melody);

// ======================================
// DISPLAY FUNCTIONS
// ======================================

void initDisplay() {
    Serial.println("Initializing SH1107 display...");
    
    if (!display.begin(0x3C, true)) {
        Serial.println("SH1107 allocation failed!");
        while(1) {
            delay(1000);
        }
    }
    
    Serial.println("Display initialized!");
    
    display.clearDisplay();
    display.setRotation(0);
    display.setTextSize(2);
    display.setTextColor(SH110X_WHITE);
    display.setCursor(10, 40);
    display.println("SCOOBY");
    display.setCursor(15, 65);
    display.println("SNACK");
    display.display();
}

void displayMessage(String message, int duration = 0) {
    display.clearDisplay();
    display.setTextSize(2);
    display.setTextColor(SH110X_WHITE);
    
    // Center message
    int16_t x1, y1;
    uint16_t w, h;
    display.getTextBounds(message, 0, 0, &x1, &y1, &w, &h);
    display.setCursor((128 - w) / 2, 50);
    display.println(message);
    display.display();
    
    if (duration > 0) {
        delay(duration);
        updateDisplay();
    }
}

void updateDisplay() {
    display.clearDisplay();
    
    // Header
    display.setTextSize(2);
    display.setCursor(10, 5);
    display.println("SCOOBY");
    display.setCursor(15, 25);
    display.println("SNACK");
    
    // Time
    DateTime now = rtc.now();
    display.setTextSize(1);
    display.setCursor(15, 50);
    char timeStr[20];
    sprintf(timeStr, "%02d:%02d:%02d", now.hour(), now.minute(), now.second());
    display.println(timeStr);
    
    // Date
    display.setCursor(10, 62);
    char dateStr[20];
    sprintf(dateStr, "%02d/%02d/%04d", now.month(), now.day(), now.year());
    display.println(dateStr);
    
    // Pills Remaining
    display.setCursor(10, 80);
    display.print("Pills: ");
    display.print(state.pillsRemaining);
    display.print("/");
    display.println(MAX_PILLS_CAPACITY);
    
    // Status
    display.setCursor(10, 95);
    if (!state.homed) {
        display.println("NOT HOMED!");
    } else if (state.pillsRemaining < 3) {
        display.println("LOW PILLS!");
    } else {
        display.println("Ready");
    }
    
    // BLE Status
    display.setCursor(10, 110);
    display.print("BLE: ");
    display.println(deviceConnected ? "OK" : "Wait");
    
    display.display();
}

// ======================================
// STEPPER MOTOR CONTROL
// ======================================

void stepMotor() {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(2);
    digitalWrite(STEP_PIN, LOW);
}

void homeStarWheel() {
    Serial.println("Homing star wheel...");
    displayMessage("Homing...");
    
    digitalWrite(DIR_PIN, HIGH);
    
    // Rotate until Hall sensor triggers (LOW)
    int maxSteps = STEPS_PER_REV * MICROSTEPS * 2;  
    int stepCount = 0;
    
    while (digitalRead(HALL_SENSOR_PIN) == HIGH && stepCount < maxSteps) {
        stepMotor();
        delayMicroseconds(1000);  
        stepCount++;
    }
    
    if (stepCount >= maxSteps) {
        Serial.println("ERROR: Homing failed!");
        displayMessage("FAIL!", 3000);
        return;
    }
    
    // Move past sensor
    for (int i = 0; i < 50; i++) {
        stepMotor();
        delayMicroseconds(1000);
    }
    
    // Reverse until sensor triggers again
    digitalWrite(DIR_PIN, LOW);
    while (digitalRead(HALL_SENSOR_PIN) == HIGH) {
        stepMotor();
        delayMicroseconds(1500);
    }
    
    state.currentPocket = 0;
    state.homed = true;
    
    Serial.println("Homing complete!");
    displayMessage("Homed!", 1500);
    
    playMelody(1);
}

void advanceOnePocket() {
    if (!state.homed) {
        Serial.println("Not homed! Homing now...");
        homeStarWheel();
        return;
    }
    
    digitalWrite(DIR_PIN, HIGH);
    
    for (int i = 0; i < STEPS_PER_POCKET; i++) {
        stepMotor();
        delayMicroseconds(500);  
    }
    
    state.currentPocket = (state.currentPocket + 1) % POCKETS_PER_REVOLUTION;
    Serial.printf("Advanced to pocket %d\n", state.currentPocket);
}

// ======================================
// PUMP CONTROL
// ======================================

void initPump() {
    ledcSetup(PUMP_PWM_CHANNEL, PUMP_PWM_FREQUENCY, PUMP_PWM_RESOLUTION);
    ledcAttachPin(PUMP_PIN, PUMP_PWM_CHANNEL);
    ledcWrite(PUMP_PWM_CHANNEL, 0);  
}

void dispenseLiquid(float mL) {
    if (!state.pumpEnabled) {
        Serial.println("Pump disabled");
        return;
    }
    
    Serial.printf("Dispensing %.1f mL...\n", mL);
    displayMessage("Pumping...");
    
    float runTime_ms = (mL / PUMP_ML_PER_SECOND) * 1000;
    
    ledcWrite(PUMP_PWM_CHANNEL, 255);
    delay((int)runTime_ms);
    ledcWrite(PUMP_PWM_CHANNEL, 0);
    
    state.totalLiquidDispensed += (uint32_t)mL;
    
    Serial.printf("Dispensed %.1f mL\n", mL);
}

// ======================================
// PILL DISPENSING
// ======================================

bool dispensePill() {
    if (state.pillsRemaining <= 0) {
        Serial.println("OUT OF PILLS!");
        displayMessage("OUT!", 3000);
        playMelody(4);
        return false;
    }
    
    Serial.println("Dispensing pill...");
    displayMessage("Dispense");
    
    advanceOnePocket();
    delay(1500);
    
    // Check IR sensor
    bool pillDetected = false;
    unsigned long startTime = millis();
    
    while (millis() - startTime < 3000) {  
        if (digitalRead(IR_SENSOR_PIN) == LOW) {
            pillDetected = true;
            Serial.println("Pill detected!");
            break;
        }
        delay(50);
    }
    
    if (pillDetected) {
        state.pillsRemaining--;
        state.totalPillsDispensed++;
        state.lastDispense = rtc.now();
        
        Serial.printf("Success! Remaining: %d\n", state.pillsRemaining);
        displayMessage("Success!", 1500);
        playMelody(2);
        
        preferences.begin("scooby", false);
        preferences.putInt("pillsLeft", state.pillsRemaining);
        preferences.end();
        
        return true;
    } else {
        Serial.println("NO PILL DETECTED!");
        displayMessage("NO PILL", 3000);
        playMelody(3);
        return false;
    }
}

void dispenseScheduledMedication(int scheduleIndex) {
    MedicationSchedule &sched = schedules[scheduleIndex];
    
    Serial.printf("Schedule %d triggered\n", scheduleIndex);
    
    if (sched.pillEnabled) {
        dispensePill();
        delay(2000);
    }
    
    if (sched.liquidEnabled && sched.liquidDose_mL > 0) {
        dispenseLiquid(sched.liquidDose_mL);
    }
    
    updateDisplay();
}

// ======================================
// BUZZER MELODIES
// ======================================

void playTone(int frequency, int duration) {
    ledcSetup(1, frequency, 8);
    ledcAttachPin(BUZZER_PIN, 1);
    ledcWrite(1, 128);
    delay(duration);
    ledcWrite(1, 0);
    ledcDetachPin(BUZZER_PIN);
}

void playMelody(int melody) {
    switch (melody) {
        case 0: // Startup
            playTone(523, 150);  
            playTone(659, 150);  
            playTone(784, 200);  
            break;
            
        case 1: // Success
            playTone(659, 100);  
            playTone(784, 100);  
            playTone(1047, 200); 
            break;
            
        case 2: // Dispense
            playTone(784, 100);  
            playTone(988, 100);  
            playTone(1047, 150); 
            break;
            
        case 3: // Warning
            playTone(440, 200);  
            delay(100);
            playTone(440, 200);  
            break;
            
        case 4: // Error
            playTone(262, 300);  
            delay(100);
            playTone(262, 300);  
            break;
    }
}

// ======================================
// RTC & SCHEDULING
// ======================================

void initRTC() {
    if (!rtc.begin()) {
        Serial.println("RTC ERROR!");
        displayMessage("RTC ERR", 3000);
        while (1) delay(1000);
    }
    
    if (rtc.lostPower()) {
        Serial.println("RTC lost power, setting time");
        rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
    
    DateTime now = rtc.now();
    Serial.printf("RTC Time: %02d:%02d:%02d\n", now.hour(), now.minute(), now.second());
}

void checkSchedules() {
    DateTime now = rtc.now();
    static uint8_t lastMinute = 255;
    
    if (now.minute() == lastMinute) return;
    lastMinute = now.minute();
    
    uint8_t currentDay = now.dayOfTheWeek();  
    
    for (int i = 0; i < MAX_SCHEDULES; i++) {
        if (!schedules[i].enabled) continue;
        if (!schedules[i].daysOfWeek[currentDay]) continue;
        
        if (schedules[i].hour == now.hour() && schedules[i].minute == now.minute()) {
            Serial.printf("Schedule %d triggered!\n", i);
            dispenseScheduledMedication(i);
        }
    }
}

// ======================================
// BLE COMMAND HANDLER
// ======================================

void handleBLECommand(String command) {
    Serial.println("BLE: " + command);
    
    if (command == "DISPENSE_PILL") {
        dispensePill();
        
    } else if (command.startsWith("DISPENSE_LIQUID:")) {
        float mL = command.substring(16).toFloat();
        dispenseLiquid(mL);
        
    } else if (command == "HOME") {
        homeStarWheel();
        
    } else if (command == "STATUS") {
        String status = String(state.pillsRemaining) + "," + 
                       String(state.homed) + "," +
                       String(state.totalPillsDispensed);
        pCharacteristic->setValue(status.c_str());
        pCharacteristic->notify();
        
    } else if (command.startsWith("REFILL:")) {
        int pills = command.substring(7).toInt();
        state.pillsRemaining = pills;
        preferences.begin("scooby", false);
        preferences.putInt("pillsLeft", state.pillsRemaining);
        preferences.end();
        displayMessage("Refill!", 2000);
    }
    
    updateDisplay();
}

// ======================================
// WEB SERVER HANDLERS
// ======================================

void handleRoot() {
    String html = R"HTML(
<!DOCTYPE html>
<html>
<head>
    <title>Scooby Snack</title>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { 
            font-family: Arial; 
            text-align: center; 
            background: #1a1a2e; 
            color: #eee; 
            margin: 0; 
            padding: 20px; 
        }
        h1 { color: #3282b8; }
        .card { 
            background: #16213e; 
            padding: 20px; 
            margin: 20px auto; 
            border-radius: 10px; 
            max-width: 500px; 
        }
        button { 
            padding: 15px 30px; 
            margin: 10px; 
            font-size: 16px; 
            cursor: pointer; 
            background: #3282b8; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            width: 200px; 
        }
        button:hover { background: #0f4c75; }
        .status { font-size: 20px; margin: 15px; }
    </style>
</head>
<body>
    <h1>🐕 Scooby Snack</h1>
    
    <div class='card'>
        <h2>Status</h2>
        <div class='status'>Pills: )HTML" + String(state.pillsRemaining) + " / " + String(MAX_PILLS_CAPACITY) + R"HTML(</div>
        <div class='status'>Homed: )HTML" + String(state.homed ? "✅" : "❌") + R"HTML(</div>
        <div class='status'>Dispensed: )HTML" + String(state.totalPillsDispensed) + R"HTML(</div>
    </div>
    
    <div class='card'>
        <h2>Control</h2>
        <button onclick="fetch('/pill')">Dispense Pill</button><br>
        <button onclick="fetch('/liquid?ml=5')">5mL Liquid</button><br>
        <button onclick="fetch('/home')">Home</button><br>
        <button onclick="fetch('/refill')">Refill (14)</button>
    </div>
    
    <script>
        setInterval(function() { 
            location.reload(); 
        }, 10000);
    </script>
</body>
</html>
)HTML";
    
    server.send(200, "text/html", html);
}

// ======================================
// WIFI & SERVER INIT
// ======================================

void initWiFi() {
    // Create AP for easy access
    WiFi.softAP("ScooobySnack", "scooby123");
    
    IPAddress IP = WiFi.softAPIP();
    Serial.print("AP IP: ");
    Serial.println(IP);
    
    displayMessage("WiFi AP\n" + IP.toString(), 3000);
}

void initWebServer() {
    server.on("/", handleRoot);
    
    server.on("/pill", []() {
        dispensePill();
        server.send(200, "text/plain", "OK");
    });
    
    server.on("/liquid", []() {
        float mL = server.arg("ml").toFloat();
        if (mL > 0) dispenseLiquid(mL);
        server.send(200, "text/plain", "OK");
    });
    
    server.on("/home", []() {
        homeStarWheel();
        server.send(200, "text/plain", "OK");
    });
    
    server.on("/refill", []() {
        state.pillsRemaining = MAX_PILLS_CAPACITY;
        preferences.begin("scooby", false);
        preferences.putInt("pillsLeft", state.pillsRemaining);
        preferences.end();
        server.send(200, "text/plain", "OK");
    });
    
    server.begin();
    Serial.println("Web server started");
}

// ======================================
// BLE INIT
// ======================================

void initBLE() {
    BLEDevice::init("ScooobySnack");
    
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    
    BLEService *pService = pServer->createService(SERVICE_UUID);
    
    pCharacteristic = pService->createCharacteristic(
        CHAR_UUID,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_NOTIFY
    );
    
    pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
    pCharacteristic->addDescriptor(new BLE2902());
    
    pService->start();
    
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    BLEDevice::startAdvertising();
    
    Serial.println("BLE started");
}

// ======================================
// SETUP
// ======================================

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n\n=== SCOOBY SNACK ===");
    
    // Pins
    pinMode(STEP_PIN, OUTPUT);
    pinMode(DIR_PIN, OUTPUT);
    pinMode(EN_PIN, OUTPUT);
    pinMode(HALL_SENSOR_PIN, INPUT_PULLUP);
    pinMode(IR_SENSOR_PIN, INPUT_PULLUP);
    pinMode(BUZZER_PIN, OUTPUT);
    
    digitalWrite(EN_PIN, LOW);  
    
    // I2C
    Wire.begin(OLED_SDA, OLED_SCL);
    
    // Display
    initDisplay();
    delay(2000);
    
    // RTC
    initRTC();
    
    // Pump
    initPump();
    
    // Load state
    preferences.begin("scooby", true);
    state.pillsRemaining = preferences.getInt("pillsLeft", MAX_PILLS_CAPACITY);
    state.totalPillsDispensed = preferences.getUInt("totalPills", 0);
    preferences.end();
    
    Serial.printf("Loaded: %d pills\n", state.pillsRemaining);
    
    // Startup sound
    playMelody(0);
    
    // Home
    displayMessage("Homing...");
    delay(1000);
    homeStarWheel();
    
    // WiFi
    initWiFi();
    initWebServer();
    
    // BLE
    initBLE();
    
    Serial.println("=== READY ===");
    displayMessage("READY!", 2000);
    updateDisplay();
}

// ======================================
// MAIN LOOP
// ======================================

void loop() {
    static unsigned long lastUpdate = 0;
    if (millis() - lastUpdate > 500) {
        updateDisplay();
        lastUpdate = millis();
    }
    
    static unsigned long lastScheduleCheck = 0;
    if (millis() - lastScheduleCheck > 5000) {
        checkSchedules();
        lastScheduleCheck = millis();
    }
    
    server.handleClient();
    
    static bool lowPillWarning = false;
    if (state.pillsRemaining < 3 && !lowPillWarning) {
        displayMessage("LOW!", 2000);
        playMelody(3);
        lowPillWarning = true;
    }
    if (state.pillsRemaining >= 3) lowPillWarning = false;
    
    delay(10);
}