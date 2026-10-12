import type { ConfigContext, ExpoConfig } from "expo/config";

// One neutral "Workspace" client serves every company on the shared server.
// Build numbers (ios.buildNumber / android.versionCode) are managed remotely
// by EAS (cli.appVersionSource "remote" in eas.json), so they are not set here.
const appId = "com.schachengineers.workspace";
const background = "#faf9f6"; // app surface; matches the icon and splash background
const camera =
  "Capture task evidence and expense receipts, share chat photos and join company video calls.";
const microphone = "Send voice notes and join company calls.";

// EAS file environment variable (secret) holding the path to google-services.json
// for FCM. Optional so local and preview builds without Firebase still resolve.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;

// expo-splash-screen owns the native splash in SDK 57. It is only configured
// once the package is installed (`npx expo install expo-splash-screen`).
function installed(name: string) {
  try {
    require.resolve(name + "/package.json");
    return true;
  } catch {
    return false;
  }
}
const splash: NonNullable<ExpoConfig["plugins"]> = installed("expo-splash-screen")
  ? [
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: background,
        },
      ],
    ]
  : [];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Workspace",
  slug: "workspace",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  scheme: "workspace",
  ios: {
    supportsTablet: true,
    bundleIdentifier: appId,
    infoPlist: {
      NSMicrophoneUsageDescription: microphone,
      NSCameraUsageDescription: camera,
      UIBackgroundModes: ["audio", "remote-notification"],
    },
  },
  android: {
    package: appId,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: background,
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      "RECORD_AUDIO",
      "CAMERA",
      "MODIFY_AUDIO_SETTINGS",
      "BLUETOOTH_CONNECT",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_MICROPHONE",
      "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    ],
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    ["expo-secure-store", { configureAndroidBackup: true }],
    [
      "expo-notifications",
      {
        // Internal channel id; renaming it would orphan existing channels.
        defaultChannel: "schach-updates",
      },
    ],
    [
      "@livekit/react-native-expo-plugin",
      { android: { audioType: "communication", enableScreenShareService: true } },
    ],
    [
      "@config-plugins/react-native-webrtc",
      { cameraPermission: camera, microphonePermission: microphone },
    ],
    "expo-router",
    [
      "expo-audio",
      { enableBackgroundRecording: false, enableBackgroundPlayback: true },
    ],
    "expo-sharing",
    "expo-asset",
    "./plugins/withCallService",
    "@react-native-community/datetimepicker",
    [
      "expo-image-picker",
      {
        cameraPermission: camera,
        photosPermission:
          "Choose a photo explicitly for company chat, task evidence or expense receipts.",
        microphonePermission: microphone,
      },
    ],
    ...splash,
  ],
});
