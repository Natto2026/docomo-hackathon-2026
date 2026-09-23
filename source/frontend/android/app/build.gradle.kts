import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/** key=value 形式のファイルから値を読む。無ければ null。 */
fun readProperty(file: File, key: String): String? {
    if (!file.exists()) return null
    val properties = Properties()
    FileInputStream(file).use { properties.load(it) }
    return properties.getProperty(key)?.trim()?.takeIf { it.isNotEmpty() }
}

// Google Maps の Android 用 API キー。ソースには書かず、Git 管理外のファイルか環境変数から読む。
//   1. frontend/android/local.properties の MAPS_API_KEY
//   2. frontend/.env の GOOGLE_MAPS_ANDROID_API_KEY
//   3. 環境変数 GOOGLE_MAPS_ANDROID_API_KEY
val mapsApiKey: String = readProperty(rootProject.file("local.properties"), "MAPS_API_KEY")
    ?: readProperty(rootProject.file("../.env"), "GOOGLE_MAPS_ANDROID_API_KEY")
    ?: System.getenv("GOOGLE_MAPS_ANDROID_API_KEY")
    ?: ""

if (mapsApiKey.isEmpty()) {
    logger.warn("Google Maps API key is not set. Add MAPS_API_KEY to android/local.properties or GOOGLE_MAPS_ANDROID_API_KEY to frontend/.env (see README).")
}

android {
    namespace = "com.example.local_area_sns"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.local_area_sns"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // AndroidManifest.xml の ${MAPS_API_KEY} に埋め込む
        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
