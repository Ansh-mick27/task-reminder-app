package com.anshmick27.taskreminder;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Opens the app in Chrome when it's installed, instead of the phone's default
 * browser. Some browsers that can host a Trusted Web Activity (e.g. Samsung
 * Internet) don't pass the app's notification permission through to the web
 * app, which breaks push reminders. Falls back to the default browser if no
 * Chrome build is installed.
 */
public class ChromeLauncherActivity extends LauncherActivity {
    private static final String[] CHROME_PACKAGES = {
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
    };

    @Override
    protected TwaLauncher createTwaLauncher() {
        String chrome = installedChrome();
        return chrome != null ? new TwaLauncher(this, chrome) : super.createTwaLauncher();
    }

    private String installedChrome() {
        PackageManager pm = getPackageManager();
        for (String pkg : CHROME_PACKAGES) {
            try {
                ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
                if (info.enabled) return pkg;
            } catch (PackageManager.NameNotFoundException ignored) {
                // Not installed; try the next one.
            }
        }
        return null;
    }
}
