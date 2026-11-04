PKG       := com.megarohas.amtv
SDK       ?= $(or $(ANDROID_HOME),$(ANDROID_SDK_ROOT),$(HOME)/Library/Android/sdk)
BT        ?= $(shell ls -d $(SDK)/build-tools/* 2>/dev/null | sort -V | tail -n 1)
PLATFORM  ?= $(shell ls -d $(SDK)/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -n 1)
KEYSTORE  ?= $(HOME)/.android/debug.keystore

# Auto-detect JAVA_HOME across Linux (GitHub Actions) and macOS
ifeq ($(origin JAVA_HOME), undefined)
  ifneq ($(wildcard /usr/libexec/java_home),)
    JAVA_HOME := $(shell /usr/libexec/java_home -v 17 2>/dev/null)
  endif
endif
ifneq ($(JAVA_HOME),)
  export JAVA_HOME
  export PATH := $(JAVA_HOME)/bin:$(PATH)
endif

# The TV box over adb: `make install TV=192.168.1.50:5555`, or put `TV = …` in local.mk (git-ignored)
-include local.mk
TV  ?=
ADB := adb $(if $(TV),-s $(TV))

ifdef DEV
PKG  := com.megarohas.amtv.dev
B    := build-dev
APK  := $(B)/Apple-Music-dev.apk
else
B    := build
APK  := $(B)/Apple-Music.apk
endif
SRC := $(shell find src -name '*.java')
RES := $(shell find res -type f)
ASSETS := $(shell find assets -type f)

.PHONY: all install start stop devtools log clean dev dev-install dev-start dev-devtools

all: $(APK)

$(KEYSTORE):
	mkdir -p $(dir $(KEYSTORE))
	keytool -genkeypair -v -keystore $(KEYSTORE) -storepass android -alias androiddebugkey \
		-keypass android -keyalg RSA -keysize 2048 -validity 10000 \
		-dname "CN=Android Debug,O=Android,C=US"

# No Gradle: aapt2 → javac → d8 → zipalign → apksigner, a few seconds end to end.
$(APK): AndroidManifest.xml $(SRC) $(RES) $(ASSETS) $(KEYSTORE)
	rm -rf $(B) && mkdir -p $(B)/classes
	"$(BT)/aapt2" compile --dir res -o $(B)/res.zip
	sed $(if $(DEV),'s|android:label="@string/app_name"|android:label="Apple Music Dev"|','') AndroidManifest.xml > $(B)/AndroidManifest.xml
	"$(BT)/aapt2" link -I "$(PLATFORM)" --manifest $(B)/AndroidManifest.xml $(if $(DEV),--rename-manifest-package $(PKG)) \
		-A assets -o $(B)/app.unsigned.apk $(B)/res.zip
	javac -source 8 -target 8 -Xlint:-options -encoding UTF-8 -bootclasspath "$(PLATFORM):$(BT)/core-lambda-stubs.jar" -d $(B)/classes $(SRC)
	"$(BT)/d8" --release --min-api 29 --lib "$(PLATFORM)" --output $(B) $$(find $(B)/classes -name '*.class')
	cd $(B) && zip -q app.unsigned.apk classes.dex
	"$(BT)/zipalign" -f -p 4 $(B)/app.unsigned.apk $(B)/app.aligned.apk
	"$(BT)/apksigner" sign --ks "$(KEYSTORE)" --ks-pass pass:android --ks-key-alias androiddebugkey \
		--key-pass pass:android --out $@ $(B)/app.aligned.apk
	cp $@ $(B)/amtv.apk
	@ls -lh $@

install: $(APK)
	$(ADB) install -r $(APK)

start:
	$(ADB) shell am start -n $(PKG)/com.megarohas.amtv.MainActivity

stop:
	$(ADB) shell am force-stop $(PKG)

devtools:
	@pid=$$($(ADB) shell pidof $(PKG)); test -n "$$pid" || { echo "app is not running"; exit 1; }; \
	$(ADB) forward tcp:9222 localabstract:webview_devtools_remote_$$pid && echo "http://localhost:9222/json"

log:
	$(ADB) logcat -s amtv chromium

clean:
	rm -rf $(B)

dev dev-install dev-start dev-devtools:
	@$(MAKE) --no-print-directory DEV=1 $(patsubst dev-%,%,$(patsubst dev,all,$@))
