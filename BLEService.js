import { BleManager } from 'react-native-ble-plx';

class BLEService {
  constructor() {
    this.manager = new BleManager();
    this.device = null;
    this.isConnected = false;
    
    // Your ESP32 UUIDs (from your firmware)
    this.SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
    this.MEDICATION_CHAR_UUID = '12345678-1234-1234-1234-123456789abd';
    this.DISPENSE_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';
    this.STATUS_CHAR_UUID = '12345678-1234-1234-1234-123456789abf';
  }

  // Start scanning for your ESP32
  async scan(onDeviceFound) {
    console.log('🔍 Scanning for ESP32...');
    
    this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error('Scan error:', error);
        return;
      }

      // Look for your ESP32 (change name if different)
      if (device.name && device.name.includes('Pill_Dispenser')) {
        console.log('✅ Found ESP32:', device.name);
        this.manager.stopDeviceScan();
        onDeviceFound(device);
      }
    });
  }

  // Connect to ESP32
  async connect(device) {
    try {
      console.log('📱 Connecting to:', device.name);
      
      this.device = await device.connect();
      console.log('✅ Connected!');
      
      await this.device.discoverAllServicesAndCharacteristics();
      console.log('✅ Services discovered!');
      
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('❌ Connection error:', error);
      return false;
    }
  }

  // Disconnect
  async disconnect() {
    if (this.device) {
      await this.device.cancelConnection();
      this.isConnected = false;
      console.log('📴 Disconnected');
    }
  }

  // Send medication to ESP32
  async sendMedication(medication) {
    if (!this.isConnected) {
      console.log('❌ Not connected!');
      return false;
    }

    try {
      const data = JSON.stringify(medication);
      const base64Data = btoa(data);
      
      await this.device.writeCharacteristicWithResponseForService(
        this.SERVICE_UUID,
        this.MEDICATION_CHAR_UUID,
        base64Data
      );
      
      console.log('✅ Medication sent:', medication.name);
      return true;
    } catch (error) {
      console.error('❌ Send error:', error);
      return false;
    }
  }

  // Trigger dispense
  async dispense(slot) {
    if (!this.isConnected) {
      console.log('❌ Not connected!');
      return false;
    }

    try {
      const command = JSON.stringify({ action: 'dispense', slot: slot });
      const base64Data = btoa(command);
      
      await this.device.writeCharacteristicWithResponseForService(
        this.SERVICE_UUID,
        this.DISPENSE_CHAR_UUID,
        base64Data
      );
      
      console.log('✅ Dispense triggered for slot:', slot);
      return true;
    } catch (error) {
      console.error('❌ Dispense error:', error);
      return false;
    }
  }

  // Get status from ESP32
  async getStatus() {
    if (!this.isConnected) {
      return null;
    }

    try {
      const characteristic = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.STATUS_CHAR_UUID
      );
      
      const data = atob(characteristic.value);
      const status = JSON.parse(data);
      
      console.log('📊 Status:', status);
      return status;
    } catch (error) {
      console.error('❌ Status error:', error);
      return null;
    }
  }
}

// Export singleton
export default new BLEService();