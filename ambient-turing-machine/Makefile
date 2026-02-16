# Project Name
TARGET = AmbientTuringMachine

# Sources
CPP_SOURCES = main_daisy.cpp sample_data.cpp
CPP_SOURCES += DaisySP/DaisySP-LGPL/Source/Effects/reverbsc.cpp

# Library Locations
LIBDAISY_DIR = ./libDaisy
DAISYSP_DIR = ./DaisySP

# Optimizations
OPT = -O2
USE_DAISYSP_LGPL = 1
APP_TYPE = BOOT_QSPI

# Core location, and generic makefile.
SYSTEM_FILES_DIR = $(LIBDAISY_DIR)/core
include $(SYSTEM_FILES_DIR)/Makefile
