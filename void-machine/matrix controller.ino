// Keyboard Matrix Test - Pico W2 (Arduino IDE)
// 3 rows x 4 columns = 12 buttons
// Diodes: cathode (black band) facing rows (up toward row wires)
// Scanning: drive row LOW, read columns (INPUT_PULLUP), pressed = LOW

// Row pins (directly active-low drive)
const int rowPins[] = {2, 3, 4};    // GP2=Row1, GP3=Row2, GP4=Row3
const int numRows = 3;

// Column pins (active-low read with internal pull-up)
// Col1=GP8, Col2=GP7, Col3=GP6, Col4=GP5
const int colPins[] = {8, 7, 6, 5};
const int numCols = 4;

// Button mapping (viewed from FRONT / user side)
// Since you're wiring from the back, columns are mirrored left-to-right
// From the front: top-left = button 1, top-right = button 4
// Back view col order (left to right): Col1(GP8), Col2(GP7), Col3(GP6), Col4(GP5)
// Front view col order (left to right): Col4(GP5), Col3(GP6), Col2(GP7), Col1(GP8)
//
// So button map [row][col] where col index 0=Col1(GP8) which is RIGHT side from front:
// Row0/Col0(GP8)=btn4, Row0/Col1(GP7)=btn3, Row0/Col2(GP6)=btn2, Row0/Col3(GP5)=btn1
// Row1/Col0(GP8)=btn8, Row1/Col1(GP7)=btn7, Row1/Col2(GP6)=btn6, Row1/Col3(GP5)=btn5
// Row2/Col0(GP8)=btn12,Row2/Col1(GP7)=btn11,Row2/Col2(GP6)=btn10,Row2/Col3(GP5)=btn9

const int buttonMap[3][4] = {
  {4,  3,  2,  1},    // Row1 (GP2)
  {8,  7,  6,  5},    // Row2 (GP3)
  {12, 11, 10, 9}     // Row3 (GP4)
};

// Potentiometer
const int potPin = 28;  // GP28 = ADC2

// Debounce tracking
bool lastState[3][4];
bool currentState[3][4];
unsigned long lastDebounce[3][4];
const unsigned long debounceDelay = 20;

// Pot tracking
int lastPotValue = -1;

void setup() {
  Serial.begin(115200);
  delay(2000);  // Wait for serial monitor to connect
  
  Serial.println("=================================");
  Serial.println("Keyboard Matrix Test - Pico W2");
  Serial.println("12 buttons + 1 potentiometer");
  Serial.println("=================================");
  
  // Set row pins as outputs, default HIGH (inactive)
  for (int r = 0; r < numRows; r++) {
    pinMode(rowPins[r], OUTPUT);
    digitalWrite(rowPins[r], HIGH);
  }
  
  // Set column pins as inputs with pull-up
  for (int c = 0; c < numCols; c++) {
    pinMode(colPins[c], INPUT_PULLUP);
  }
  
  // Initialize states
  for (int r = 0; r < numRows; r++) {
    for (int c = 0; c < numCols; c++) {
      lastState[r][c] = false;
      currentState[r][c] = false;
      lastDebounce[r][c] = 0;
    }
  }
  
  // Potentiometer pin
  analogReadResolution(10);  // 0-1023
  
  Serial.println("Ready! Press buttons or turn the pot...");
  Serial.println();
}

void loop() {
  scanMatrix();
  readPot();
  delay(1);  // Small delay for stability
}

void scanMatrix() {
  for (int r = 0; r < numRows; r++) {
    // Drive current row LOW
    digitalWrite(rowPins[r], LOW);
    delayMicroseconds(10);  // Let signals settle
    
    for (int c = 0; c < numCols; c++) {
      bool pressed = (digitalRead(colPins[c]) == LOW);
      
      // Debounce
      if (pressed != lastState[r][c]) {
        lastDebounce[r][c] = millis();
      }
      
      if ((millis() - lastDebounce[r][c]) > debounceDelay) {
        if (pressed != currentState[r][c]) {
          currentState[r][c] = pressed;
          
          int btnNum = buttonMap[r][c];
          
          if (pressed) {
            Serial.print("Button ");
            Serial.print(btnNum);
            Serial.print(" PRESSED   (Row");
            Serial.print(r + 1);
            Serial.print("/GP");
            Serial.print(rowPins[r]);
            Serial.print(" x Col");
            Serial.print(c + 1);
            Serial.print("/GP");
            Serial.print(colPins[c]);
            Serial.println(")");
          } else {
            Serial.print("Button ");
            Serial.print(btnNum);
            Serial.println(" RELEASED");
          }
        }
      }
      
      lastState[r][c] = pressed;
    }
    
    // Set row back to HIGH (inactive)
    digitalWrite(rowPins[r], HIGH);
  }
}

void readPot() {
  int potValue = analogRead(potPin);
  
  // Only print if value changed by more than 5 (reduce noise)
  if (abs(potValue - lastPotValue) > 5) {
    lastPotValue = potValue;
    Serial.print("Potentiometer (GP28): ");
    Serial.print(potValue);
    Serial.print(" / 1023  (");
    Serial.print(map(potValue, 0, 1023, 0, 100));
    Serial.println("%)");
  }
}
