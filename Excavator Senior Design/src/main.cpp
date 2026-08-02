#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

// Diagnostic sketch: prints live readings from 2x AS5600 magnetic encoders
// and 1x VL53L0X time-of-flight sensor, all wired behind a TCA9548A I2C mux
// (the encoders share address 0x36, so each needs its own mux channel; the
// VL53L0X is also behind the mux here rather than on the main bus).
//
// Channel assignment confirmed by scanning all 8 mux channels:
<<<<<<< HEAD
//   channel 0 -> VL53L0X  (0x29)
//   channel 1 -> Encoder2 (0x36)
//   channel ? -> Encoder1 (0x36, not yet confirmed on the mux)
=======
//   channel 0 -> Encoder1 (0x36)
//   channel 1 -> Encoder2 (0x36)
//   channel 2 -> VL53L0X  (0x29)
>>>>>>> efe6038fe7aca72733d9e1c5e8dd2800fc605b94

#define TCA9548A_ADDR 0x70
#define AS5600_ADDR 0x36

#define ENCODER1_CHANNEL 0
<<<<<<< HEAD
#define ENCODER2_CHANNEL 2
#define TOF_CHANNEL 1
=======
#define ENCODER2_CHANNEL 1
#define TOF_CHANNEL 2
>>>>>>> efe6038fe7aca72733d9e1c5e8dd2800fc605b94

#define AS5600_REG_STATUS 0x0B
#define AS5600_REG_RAW_ANGLE 0x0C
#define AS5600_REG_ANGLE 0x0E
#define AS5600_REG_AGC 0x1A
#define AS5600_REG_MAGNITUDE 0x1B

Adafruit_VL53L0X lox = Adafruit_VL53L0X();
bool vl53l0x_ok = false;

void tcaSelect(uint8_t channel) {
  if (channel > 7)
    return;
  Wire.beginTransmission(TCA9548A_ADDR);
  Wire.write(1 << channel);
  Wire.endTransmission();
}

<<<<<<< HEAD
// Prints every address that ACKs on the currently-selected bus/channel.
void scanI2C(const char *label) {
  Serial.print(label);
  Serial.print(F(": "));
  uint8_t count = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("0x"));
      if (addr < 16)
        Serial.print('0');
      Serial.print(addr, HEX);
      Serial.print(' ');
      count++;
    }
  }
  if (count == 0)
    Serial.print(F("(none)"));
  Serial.println();
}

=======
>>>>>>> efe6038fe7aca72733d9e1c5e8dd2800fc605b94
bool as5600ReadRegister16(uint8_t reg, uint16_t &value) {
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0)
    return false;
  if (Wire.requestFrom((uint8_t)AS5600_ADDR, (uint8_t)2) != 2)
    return false;
  uint16_t hi = Wire.read();
  uint16_t lo = Wire.read();
  value = ((hi << 8) | lo) & 0x0FFF;
  return true;
}

bool as5600ReadRegister8(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0)
    return false;
  if (Wire.requestFrom((uint8_t)AS5600_ADDR, (uint8_t)1) != 1)
    return false;
  value = Wire.read();
  return true;
}

void printEncoder(uint8_t channel, const char *label) {
  tcaSelect(channel);
  delay(2);

  uint8_t status = 0, agc = 0;
  uint16_t rawAngle = 0, angle = 0, magnitude = 0;
  bool ok = as5600ReadRegister8(AS5600_REG_STATUS, status);
  ok &= as5600ReadRegister16(AS5600_REG_RAW_ANGLE, rawAngle);
  ok &= as5600ReadRegister16(AS5600_REG_ANGLE, angle);
  ok &= as5600ReadRegister8(AS5600_REG_AGC, agc);
  ok &= as5600ReadRegister16(AS5600_REG_MAGNITUDE, magnitude);

  Serial.print(label);
  if (!ok) {
    Serial.println(F(": NOT FOUND (check mux channel / wiring)"));
    return;
  }

  bool magnetDetected = status & 0x20; // MD
  bool tooWeak = status & 0x10;        // ML
  bool tooStrong = status & 0x08;      // MH
  Serial.print(F(": magnet="));
  if (magnetDetected) {
    Serial.print(F("YES"));
  } else if (tooWeak) {
    Serial.print(F("TOO_WEAK"));
  } else if (tooStrong) {
    Serial.print(F("TOO_STRONG"));
  } else {
    Serial.print(F("NO"));
  }
  Serial.print(F(" raw_angle="));
  Serial.print(rawAngle);
  Serial.print(F(" angle="));
  Serial.print(angle);
  Serial.print(F(" agc="));
  Serial.print(agc);
  Serial.print(F(" magnitude="));
  Serial.println(magnitude);
}

void printToF() {
  tcaSelect(TOF_CHANNEL);

  Serial.print(F("ToF: "));
  if (!vl53l0x_ok) {
    Serial.println(F("NOT FOUND (check wiring)"));
    return;
  }

  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);

  Serial.print(F("distance_mm="));
  if (measure.RangeStatus != 4) { // 4 = phase failure, no valid reading
    Serial.print(measure.RangeMilliMeter);
  } else {
    Serial.print(-1);
  }
  Serial.print(F(" status="));
  Serial.println(measure.RangeStatus);
}

void setup() {
  Serial.begin(115200);
  while (!Serial)
    delay(10);

  Wire.begin();
<<<<<<< HEAD
  // Bound every I2C transaction so a stuck/missing device can't hang the
  // sketch forever -- resets the AVR TWI hardware on timeout.
  Wire.setWireTimeout(25000, true);

  Serial.println(F("# I2C sensor test: 2x AS5600 + 1x VL53L0X, all via TCA9548A"));

  Serial.println(F("# step: checking mux ack at 0x70"));
  Wire.beginTransmission(TCA9548A_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println(F("# WARNING: TCA9548A mux not responding at 0x70"));
  } else {
    Serial.println(F("# mux ack OK"));
  }

  Serial.println(F("# step: scanning main bus (no channel selected)"));
  scanI2C("main bus");

  for (uint8_t ch = 0; ch <= 7; ch++) {
    Serial.print(F("# step: scanning mux channel "));
    Serial.println(ch);
    tcaSelect(ch);
    delay(2);
    char label[16];
    snprintf(label, sizeof(label), "channel %u", ch);
    scanI2C(label);
  }

  Serial.println(F("# step: selecting TOF channel"));
  tcaSelect(TOF_CHANNEL);
  Serial.println(F("# step: calling lox.begin()"));
=======

  Serial.println(F("# I2C sensor test: 2x AS5600 + 1x VL53L0X, all via TCA9548A"));

  Wire.beginTransmission(TCA9548A_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println(F("# WARNING: TCA9548A mux not responding at 0x70"));
  }

  tcaSelect(TOF_CHANNEL);
>>>>>>> efe6038fe7aca72733d9e1c5e8dd2800fc605b94
  if (lox.begin()) {
    vl53l0x_ok = true;
    Serial.println(F("# VL53L0X ready"));
  } else {
    Serial.println(F("# VL53L0X NOT FOUND -- check wiring"));
  }
<<<<<<< HEAD
  Serial.println(F("# step: setup complete, entering loop"));
=======
>>>>>>> efe6038fe7aca72733d9e1c5e8dd2800fc605b94
}

void loop() {
  printEncoder(ENCODER1_CHANNEL, "Encoder1");
  printEncoder(ENCODER2_CHANNEL, "Encoder2");
  printToF();
  Serial.println();

  delay(500);
<<<<<<< HEAD
}
=======
}
>>>>>>> efe6038fe7aca72733d9e1c5e8dd2800fc605b94
