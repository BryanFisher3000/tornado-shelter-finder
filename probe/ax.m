// One-off helper for the throwaway check, not part of the app. Lists, presses or clicks the controls
// in a Mac app's windows through the macOS accessibility API. Used on Xcode's Device Hub, whose
// Closed / Partially Open / Open buttons are the only way to fold the iPhone Duo simulator.
//   ax trusted                    is this tool allowed to use the accessibility API
//   ax <pid> dump [max lines]     every control in the app's windows, then its menus
//   ax <pid> press "<label>" ["<other label>"]   press the control in a window that carries that label
//                                 (of several, the one nearest to the control with the other label)
//   ax <pid> menu "<label>"       the same, in the menu bar
//   ax <pid> click "<label>"      click the middle of the first thing in a window that carries that label
#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int gCount = 0, gMax = 900;

static id copyAttr(AXUIElementRef e, NSString *name) {
    CFTypeRef v = NULL;
    AXError err = AXUIElementCopyAttributeValue(e, (__bridge CFStringRef)name, &v);
    if (err != kAXErrorSuccess || v == NULL) return nil;
    return CFBridgingRelease(v);
}
static NSString *str(AXUIElementRef e, NSString *name) {
    id o = copyAttr(e, name);
    if ([o isKindOfClass:[NSString class]]) return (NSString *)o;
    if ([o isKindOfClass:[NSNumber class]]) return [(NSNumber *)o stringValue];
    return @"";
}
static NSArray *kids(AXUIElementRef e, NSString *name) {
    id o = copyAttr(e, name);
    return [o isKindOfClass:[NSArray class]] ? (NSArray *)o : @[];
}
static NSArray *actions(AXUIElementRef e) {
    CFArrayRef a = NULL;
    if (AXUIElementCopyActionNames(e, &a) != kAXErrorSuccess || a == NULL) return @[];
    return CFBridgingRelease(a);
}
static CGRect rect(AXUIElementRef e) {
    CGPoint p = CGPointZero; CGSize s = CGSizeZero;
    CFTypeRef pv = NULL, sv = NULL;
    if (AXUIElementCopyAttributeValue(e, CFSTR("AXPosition"), &pv) == kAXErrorSuccess && pv != NULL) {
        if (CFGetTypeID(pv) == AXValueGetTypeID()) AXValueGetValue((AXValueRef)pv, kAXValueTypeCGPoint, &p);
        CFRelease(pv);
    }
    if (AXUIElementCopyAttributeValue(e, CFSTR("AXSize"), &sv) == kAXErrorSuccess && sv != NULL) {
        if (CFGetTypeID(sv) == AXValueGetTypeID()) AXValueGetValue((AXValueRef)sv, kAXValueTypeCGSize, &s);
        CFRelease(sv);
    }
    return CGRectMake(p.x, p.y, s.width, s.height);
}
static NSString *frame(AXUIElementRef e) {
    CGRect r = rect(e);
    return [NSString stringWithFormat:@"%.0f,%.0f %.0fx%.0f", r.origin.x, r.origin.y, r.size.width, r.size.height];
}

static void walk(AXUIElementRef e, int depth) {
    if (gCount >= gMax || depth > 40) return;
    gCount++;
    NSMutableString *line = [NSMutableString string];
    for (int i = 0; i < depth; i++) [line appendString:@"  "];
    NSString *role = str(e, @"AXRole");
    [line appendString:role.length ? role : @"?"];
    NSArray *names = @[@"AXSubrole", @"AXTitle", @"AXDescription", @"AXIdentifier", @"AXHelp", @"AXValue"];
    for (NSString *k in names) {
        NSString *v = str(e, k);
        if (v.length == 0) continue;
        if (v.length > 80) v = [v substringToIndex:80];
        v = [v stringByReplacingOccurrencesOfString:@"\n" withString:@" "];
        [line appendFormat:@" %@=\"%@\"", [k substringFromIndex:2], v];
    }
    if ([str(e, @"AXEnabled") isEqualToString:@"0"]) [line appendString:@" (disabled)"];
    if ([str(e, @"AXSelected") isEqualToString:@"1"]) [line appendString:@" (selected)"];
    [line appendFormat:@" [%@]", frame(e)];
    if ([actions(e) containsObject:@"AXPress"]) [line appendString:@" press"];
    printf("%s\n", line.UTF8String);
    for (id c in kids(e, @"AXChildren")) walk((__bridge AXUIElementRef)c, depth + 1);
}

// does this control, or (deeper > 0) one of its children, carry the label
static BOOL labelled(AXUIElementRef e, NSString *label, BOOL exact, int deeper) {
    NSArray *names = @[@"AXTitle", @"AXDescription", @"AXIdentifier", @"AXHelp", @"AXValue"];
    for (NSString *k in names) {
        NSString *v = str(e, k);
        if (v.length == 0) continue;
        if (exact) { if ([v caseInsensitiveCompare:label] == NSOrderedSame) return YES; }
        else if ([v rangeOfString:label options:NSCaseInsensitiveSearch].location != NSNotFound) return YES;
    }
    if (deeper > 0) {
        for (id c in kids(e, @"AXChildren")) if (labelled((__bridge AXUIElementRef)c, label, exact, deeper - 1)) return YES;
    }
    return NO;
}
static void find(AXUIElementRef e, NSString *label, BOOL exact, int deeper, BOOL needPress, int depth, NSMutableArray *hits) {
    if (gCount >= 8000 || depth > 40) return;
    gCount++;
    BOOL usable = needPress ? [actions(e) containsObject:@"AXPress"] : ![str(e, @"AXRole") isEqualToString:@"AXWindow"];
    if (usable && labelled(e, label, exact, deeper)) [hits addObject:(__bridge id)e];
    for (id c in kids(e, @"AXChildren")) find((__bridge AXUIElementRef)c, label, exact, deeper, needPress, depth + 1, hits);
}
static void clickAt(CGPoint p) {
    CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, p, kCGMouseButtonLeft);
    CGEventRef down = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, p, kCGMouseButtonLeft);
    CGEventRef up = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, p, kCGMouseButtonLeft);
    if (move) { CGEventPost(kCGHIDEventTap, move); CFRelease(move); }
    usleep(200000);
    if (down) { CGEventPost(kCGHIDEventTap, down); CFRelease(down); }
    usleep(90000);
    if (up) { CGEventPost(kCGHIDEventTap, up); CFRelease(up); }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) { printf("usage: ax trusted | ax <pid> dump [max] | ax <pid> press|menu|click <label>\n"); return 2; }
        if (strcmp(argv[1], "trusted") == 0) {
            BOOL ok = AXIsProcessTrusted();
            printf("accessibility allowed for this tool: %s\n", ok ? "yes" : "no");
            return ok ? 0 : 1;
        }
        pid_t pid = (pid_t)atoi(argv[1]);
        NSString *cmd = argc > 2 ? [NSString stringWithUTF8String:argv[2]] : @"dump";
        AXUIElementRef app = AXUIElementCreateApplication(pid);
        AXUIElementSetMessagingTimeout(app, 6.0);
        CFTypeRef roleValue = NULL;
        AXError first = AXUIElementCopyAttributeValue(app, CFSTR("AXRole"), &roleValue);
        if (roleValue != NULL) CFRelease(roleValue);
        NSArray *windows = kids(app, @"AXWindows");
        printf("app pid %d: first lookup error %d, %lu window(s)\n", (int)pid, (int)first, (unsigned long)windows.count);
        if ([cmd isEqualToString:@"dump"]) {
            if (argc > 3) gMax = atoi(argv[3]);
            for (id w in windows) walk((__bridge AXUIElementRef)w, 0);
            printf("--- menus\n");
            id bar = copyAttr(app, @"AXMenuBar");
            if (bar != nil) walk((__bridge AXUIElementRef)bar, 0);
            printf("(%d lines%s)\n", gCount, gCount >= gMax ? ", cut off there" : "");
            return 0;
        }
        NSString *label = argc > 3 ? [NSString stringWithUTF8String:argv[3]] : @"";
        if (label.length == 0) { printf("no label given\n"); return 2; }
        NSArray *roots = windows;
        if ([cmd isEqualToString:@"menu"]) { id bar = copyAttr(app, @"AXMenuBar"); roots = bar != nil ? @[bar] : @[]; }
        BOOL click = [cmd isEqualToString:@"click"];
        NSMutableArray *hits = [NSMutableArray array];
        // the exact label, then the exact label on a child, then part of a label, then part of a child's label
        for (int pass = 0; pass < 4 && hits.count == 0; pass++) {
            gCount = 0;
            for (id r in roots) find((__bridge AXUIElementRef)r, label, pass < 2, pass % 2, !click, 0, hits);
        }
        printf("%lu control(s) for \"%s\"\n", (unsigned long)hits.count, label.UTF8String);
        if (hits.count == 0) return 3;
        NSUInteger pick = 0;
        if (argc > 4 && hits.count > 1) {   // several: take the one nearest to the control that carries this other label
            NSMutableArray *anchors = [NSMutableArray array];
            gCount = 0;
            for (id r in roots) find((__bridge AXUIElementRef)r, [NSString stringWithUTF8String:argv[4]], YES, 0, NO, 0, anchors);
            if (anchors.count > 0) {
                CGRect a = rect((__bridge AXUIElementRef)anchors[0]);
                double best = 1e18;
                for (NSUInteger i = 0; i < hits.count; i++) {
                    CGRect h = rect((__bridge AXUIElementRef)hits[i]);
                    double dx = CGRectGetMidX(h) - CGRectGetMidX(a), dy = CGRectGetMidY(h) - CGRectGetMidY(a);
                    if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; pick = i; }
                }
            }
        }
        AXUIElementRef hit = (__bridge AXUIElementRef)hits[pick];
        printf("using: %s title=\"%s\" description=\"%s\" [%s]\n", str(hit, @"AXRole").UTF8String, str(hit, @"AXTitle").UTF8String, str(hit, @"AXDescription").UTF8String, frame(hit).UTF8String);
        if (click) {
            CGRect r = rect(hit);
            if (r.size.width < 1 || r.size.height < 1) { printf("it has no size on screen\n"); return 4; }
            clickAt(CGPointMake(CGRectGetMidX(r), CGRectGetMidY(r)));
            printf("clicked at %.0f,%.0f\n", CGRectGetMidX(r), CGRectGetMidY(r));
            return 0;
        }
        AXError err = AXUIElementPerformAction(hit, CFSTR("AXPress"));
        printf("pressed -> error %d\n", (int)err);
        return err == kAXErrorSuccess ? 0 : 4;
    }
}
