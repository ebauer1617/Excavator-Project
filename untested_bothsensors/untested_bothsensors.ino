/*!
 * @file AS5600_fulltest.ino
 *
 * Full library testing example for the Adafruit AS5600 library
 *
 * Written by Limor Fried for Adafruit Industries.
 * MIT license, all text above must be included in any redistribution
 */

#include <Adafruit_AS5600.h>
#include "Adafruit_VL53L0X.h"

int counter = 0;

Adafruit_VL53L0X lox = Adafruit_VL53L0X();
Adafruit_AS5600 as5600;
Adafruit_AS5600 as5600_2;

void setup() {
  Serial.begin(9600);
  while (!Serial)
    delay(10);

  Serial.println("Adafruit AS5600 Full Test");
  Serial.println("Adafruit VL53L0X test");

  
  if (!as5600.begin(),!lox.begin()) {
    Serial.println("Could not find AS5600 sensor, check wiring!");
    Serial.println(F("Failed to boot VL53L0X"));
    while (1)
      delay(10);
  }
  Serial.println(F("VL53L0X API Simple Ranging example\n\n")); 
  Serial.println("AS5600 found!");
}

void loop() {
  // Continuously read and display angle values
  uint16_t rawAngle = as5600.getRawAngle();
  uint16_t angle = as5600.getAngle();
  VL53L0X_RangingMeasurementData_t measure;
//AS5600
  Serial.print("Raw: ");
  Serial.print(rawAngle);
  Serial.print(" (0x");
  Serial.print(rawAngle, HEX);
  Serial.print(") | Scaled: ");
  Serial.print(angle);
  Serial.print(" (0x");
  Serial.print(angle, HEX);
  Serial.print(")");
  
    // Check status conditions
  if (as5600.isMagnetDetected()) {
    Serial.print(" | Magnet: YES");
  }
  if (as5600.isAGCminGainOverflow()) {
    Serial.print(" | MH: magnet too strong");
  }
  if (as5600.isAGCmaxGainOverflow()) {
    Serial.print(" | ML: magnet too weak");
  }
  // Get AGC and Magnitude values
    uint8_t agc = as5600.getAGC();
  uint16_t magnitude = as5600.getMagnitude();
  Serial.print(" | AGC: ");
  Serial.print(agc);
  Serial.print(" | Mag: ");
  Serial.print(magnitude);

  //VL53L0X
  Serial.print("Reading a measurement... ");
  lox.rangingTest(&measure, false); // pass in 'true' to get debug data printout!

  if (measure.RangeStatus != 4) {  // phase failures have incorrect data
    Serial.print("Distance (mm): "); Serial.println(measure.RangeMilliMeter);
  } else {
    Serial.println(" out of range ");
  }

  counter++;
  delay(250);
if(counter>=25){
  while(true){}
 }
  
}







