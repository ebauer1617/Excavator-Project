#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

// Diagnostic sketch: prints live readings from 2x AS5600 magnetic encoders
// and 1x VL53L0X time-of-flight sensor, all wired behind a TCA9548A I2C mux
// (the encoders share address 0x36, so each needs its own mux channel; the
// VL53L0X is also behind the mux here rather than on the main bus).
//
// Channel assignment confirmed by scanning all 8 mux channels:
//   channel 0 -> Encoder1 (0x36)
//   channel 1 -> Encoder2 (0x36)
//   channel 2 -> VL53L0X  (0x29)

#define TCA9548A_ADDR 0x70
#define AS5600_ADDR 0x36

#define ENCODER1_CHANNEL 0
#define ENCODER2_CHANNEL 1
#define TOF_CHANNEL 2

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

  Serial.println(F("# I2C sensor test: 2x AS5600 + 1x VL53L0X, all via TCA9548A"));

  Wire.beginTransmission(TCA9548A_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println(F("# WARNING: TCA9548A mux not responding at 0x70"));
  }

  tcaSelect(TOF_CHANNEL);
  if (lox.begin()) {
    vl53l0x_ok = true;
    Serial.println(F("# VL53L0X ready"));
  } else {
    Serial.println(F("# VL53L0X NOT FOUND -- check wiring"));
  }
}

void loop() {
  printEncoder(ENCODER1_CHANNEL, "Encoder1");
  printEncoder(ENCODER2_CHANNEL, "Encoder2");
  printToF();
  Serial.println();

  delay(500);
}
