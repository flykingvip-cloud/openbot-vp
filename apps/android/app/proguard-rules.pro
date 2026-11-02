# ── App classes ───────────────────────────────────────────────────
-keep class ai.openbot.app.** { *; }

# ── Bouncy Castle ─────────────────────────────────────────────────
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# ── CameraX ───────────────────────────────────────────────────────
-keep class androidx.camera.** { *; }

# ── kotlinx.serialization ────────────────────────────────────────
# App models are also covered by the package keep above. These rules are the
# R8 full-mode set so a later minifyEnabled release can shrink without
# dropping serializers. Signature is required for generic serializers.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault,InnerClasses,EnclosingMethod,Signature
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class * {
    @kotlinx.serialization.Serializable *;
}

-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}

-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}

-keepclassmembers class *$$serializer {
    *** Companion;
}

# Crash reports stay readable after a future R8 release shrink.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── OkHttp ────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.jsse.**
-dontwarn org.openjsse.**
-keep class okhttp3.internal.platform.** { *; }

# ── Misc suppressions ────────────────────────────────────────────
-dontwarn com.sun.jna.**
-dontwarn javax.naming.**
-dontwarn lombok.Generated
-dontwarn org.slf4j.impl.StaticLoggerBinder
-dontwarn sun.net.spi.nameservice.NameServiceDescriptor
