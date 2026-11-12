package com.surviveastorm.shelterfinder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Small native helpers the page can call (Capacitor plugin "SasNative"), registered in MainActivity. */
@CapacitorPlugin(name = "SasNative")
public class SasNativePlugin extends Plugin {

    /** A buzz pattern from the page: [wait, buzz, pause, buzz, ...] in milliseconds. */
    private static long[] pattern(PluginCall call, String key) {
        JSArray list = call.getArray(key);
        if (list == null || list.length() == 0) return null;
        long[] out = new long[list.length()];
        boolean any = false;
        for (int i = 0; i < out.length; i++) {
            out[i] = Math.max(0, list.optLong(i, 0));
            if (i % 2 == 1 && out[i] > 0) any = true;
        }
        return any ? out : null;
    }

    /**
     * Makes a notification channel that buzzes in its own pattern (Capacitor's createChannel can only
     * switch vibration on or off). Android keeps a channel's sound and vibration as they were first
     * made, so a different pattern needs a new channel id.
     */
    @PluginMethod
    public void createAlertChannel(PluginCall call) {
        String id = call.getString("id");
        String name = call.getString("name");
        if (id == null || name == null) {
            call.reject("A channel needs an id and a name.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        NotificationChannel channel = new NotificationChannel(id, name, call.getInt("importance", NotificationManager.IMPORTANCE_HIGH));
        channel.setDescription(call.getString("description", ""));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        long[] buzz = pattern(call, "vibration");
        if (buzz != null) channel.setVibrationPattern(buzz);
        channel.enableVibration(buzz != null);
        String light = call.getString("lightColor");
        if (light != null) {
            try {
                channel.setLightColor(Color.parseColor(light));
                channel.enableLights(true);
            } catch (IllegalArgumentException e) {
                // no light then
            }
        }
        String sound = call.getString("sound");
        if (sound != null && !sound.isEmpty()) {
            if (sound.contains(".")) sound = sound.substring(0, sound.lastIndexOf('.'));
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
            channel.setSound(Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getContext().getPackageName() + "/raw/" + sound), attrs);
        }
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("Notifications are not available.");
            return;
        }
        manager.createNotificationChannel(channel);
        call.resolve();
    }

    /** Buzzes the phone now, in the given pattern: for an alert that arrives while the app is open. */
    @PluginMethod
    public void vibrate(PluginCall call) {
        long[] buzz = pattern(call, "pattern");
        Vibrator vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (buzz != null && vibrator != null && vibrator.hasVibrator()) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build();
                    vibrator.vibrate(VibrationEffect.createWaveform(buzz, -1), attrs);
                } else {
                    vibrator.vibrate(buzz, -1);
                }
            } catch (RuntimeException e) {
                // a phone that refuses: the alert still shows and sounds
            }
        }
        call.resolve();
    }
}
