// One-off probe, not part of the app. Shows a full-screen web view the way the app does and writes
// what the iPhone Duo simulator reports (safe areas, reserved regions, the vertical bar) to
// Documents/result.txt. Launch arguments: <mode> [eval:<javascript>]
//   web | web-nobar          ruler page; -nobar turns the vertical bar off
//   app | app-nobar          the app page from the www folder; add the argument "first" to start on the first screen
//   safari-popover | safari-full   in-app browser over the ruler page, the two ways the app can show it
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <SafariServices/SafariServices.h>
#import <objc/runtime.h>
#import <objc/message.h>

static NSDate *gStart;
static void plog(NSString *s) {
    if (!gStart) gStart = [NSDate date];
    NSString *line = [NSString stringWithFormat:@"%6.2f %@\n", [[NSDate date] timeIntervalSinceDate:gStart], s];
    NSLog(@"%@", s);
    NSURL *url = [[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask][0] URLByAppendingPathComponent:@"result.txt"];
    NSFileHandle *h = [NSFileHandle fileHandleForWritingAtPath:url.path];
    NSData *d = [line dataUsingEncoding:NSUTF8StringEncoding];
    if (h) { [h seekToEndOfFile]; [h writeData:d]; [h closeFile]; } else { [d writeToURL:url atomically:YES]; }
}
static NSString *ins(UIEdgeInsets e) { return [NSString stringWithFormat:@"t%.1f l%.1f b%.1f r%.1f", e.top, e.left, e.bottom, e.right]; }
static NSString *rct(CGRect r) { return [NSString stringWithFormat:@"x%.1f y%.1f w%.1f h%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height]; }

static void listSelectors(Class cls, BOOL meta) {
    if (!cls) return;
    Class c = meta ? object_getClass(cls) : cls;
    unsigned int n = 0; Method *ms = class_copyMethodList(c, &n);
    NSMutableArray *hits = [NSMutableArray array];
    NSArray *words = @[@"erticalBar", @"eservedRegion", @"ornerAdapt", @"LayoutRegion", @"DynamicIsland", @"SensorRegion", @"ameraRegion"];
    for (unsigned int i = 0; i < n; i++) {
        NSString *name = NSStringFromSelector(method_getName(ms[i]));
        if ([name hasPrefix:@"_"]) continue;
        for (NSString *w in words) if ([name containsString:w]) { [hits addObject:name]; break; }
    }
    free(ms);
    if (hits.count) plog([NSString stringWithFormat:@"selectors %@%@: %@", meta ? @"+" : @"-", NSStringFromClass(cls), [hits componentsJoinedByString:@" "]]);
}

@interface SchemeHandler : NSObject <WKURLSchemeHandler>
@property (nonatomic, strong) NSURL *root;
@end
@implementation SchemeHandler
- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSURL *u = task.request.URL; NSString *p = u.path;
    if (p.length <= 1) p = @"/index.html";
    NSURL *f = [self.root URLByAppendingPathComponent:[p substringFromIndex:1]];
    NSData *d = [NSData dataWithContentsOfURL:f];
    if (!d) {
        NSHTTPURLResponse *r = [[NSHTTPURLResponse alloc] initWithURL:u statusCode:404 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type": @"text/plain"}];
        [task didReceiveResponse:r]; [task didReceiveData:[@"not found" dataUsingEncoding:NSUTF8StringEncoding]]; [task didFinish];
        plog([NSString stringWithFormat:@"404 %@", p]);
        return;
    }
    NSDictionary *types = @{@"html": @"text/html; charset=utf-8", @"js": @"text/javascript; charset=utf-8", @"css": @"text/css; charset=utf-8", @"json": @"application/json",
        @"png": @"image/png", @"jpg": @"image/jpeg", @"jpeg": @"image/jpeg", @"svg": @"image/svg+xml", @"webp": @"image/webp", @"woff2": @"font/woff2", @"woff": @"font/woff",
        @"mp3": @"audio/mpeg", @"mp4": @"video/mp4", @"ico": @"image/x-icon"};
    NSString *ct = types[f.pathExtension.lowercaseString] ?: @"application/octet-stream";
    NSHTTPURLResponse *r = [[NSHTTPURLResponse alloc] initWithURL:u statusCode:200 HTTPVersion:@"HTTP/1.1"
        headerFields:@{@"Content-Type": ct, @"Content-Length": [NSString stringWithFormat:@"%lu", (unsigned long)d.length], @"Access-Control-Allow-Origin": @"*", @"Cache-Control": @"no-store"}];
    [task didReceiveResponse:r]; [task didReceiveData:d]; [task didFinish];
}
- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end

@interface ProbeVC : UIViewController <WKScriptMessageHandler, WKNavigationDelegate, SFSafariViewControllerDelegate>
@property (nonatomic, strong) WKWebView *web;
@property (nonatomic, strong) SchemeHandler *handler;
@property (nonatomic, copy) NSString *mode;
@property (nonatomic, copy) NSString *evalJS;
@property (nonatomic) BOOL noBar;
@property (nonatomic, copy) NSString *lastLayout;
@end

@implementation ProbeVC
- (void)loadView {
    WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
    [cfg.userContentController addScriptMessageHandler:self name:@"log"];
    cfg.allowsInlineMediaPlayback = YES;
    cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    self.handler = [SchemeHandler new];
    self.handler.root = [[NSBundle mainBundle].bundleURL URLByAppendingPathComponent:@"www"];
    [cfg setURLSchemeHandler:self.handler forURLScheme:@"capacitor"];
    NSString *cand = [NSString stringWithContentsOfURL:[[NSBundle mainBundle].bundleURL URLByAppendingPathComponent:@"candidates.json"] encoding:NSUTF8StringEncoding error:nil];
    NSMutableString *start = [NSMutableString stringWithFormat:@"window.CANDIDATES = %@;\n", cand.length ? cand : @"[]"];
    if ([self.mode hasPrefix:@"app"]) {
        // "first" as an extra argument: start like a new install, on the first screen with the terms
        BOOL first = [[NSProcessInfo processInfo].arguments containsObject:@"first"];
        [start appendString:first ? @"try { localStorage.removeItem('sas.agreed'); localStorage.removeItem('sas.onboarded'); } catch (e) {}\n"
            : @"try { localStorage.setItem('sas.onboarded', 'true'); localStorage.setItem('sas.agreed', 'true'); } catch (e) {}\n"];
        [start appendString:@"try { var fix = function (ok) { setTimeout(function () { ok({ coords: { latitude: 37.6872, longitude: -97.3301, accuracy: 10 }, timestamp: Date.now() }); }, 60); };\n"
            "  navigator.geolocation.getCurrentPosition = fix; navigator.geolocation.watchPosition = function (ok) { fix(ok); return 1; }; } catch (e) {}\n"
            "window.addEventListener('error', function (e) { try { window.webkit.messageHandlers.log.postMessage('JS error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); } catch (x) {} });\n"];
    }
    [cfg.userContentController addUserScript:[[WKUserScript alloc] initWithSource:start injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    self.web = [[WKWebView alloc] initWithFrame:CGRectZero configuration:cfg];
    self.web.navigationDelegate = self;
    self.web.scrollView.bounces = NO;
    self.web.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;   // what Capacitor's contentInset "never" sets
    self.web.opaque = NO;
    self.web.backgroundColor = [UIColor colorWithRed:0.95 green:0.95 blue:0.94 alpha:1];
    self.view = self.web;
}
- (UIVerticalBarBehavior)preferredVerticalBarBehavior { return self.noBar ? UIVerticalBarBehaviorDisabled : UIVerticalBarBehaviorAutomatic; }
- (void)viewDidLoad {
    [super viewDidLoad];
    plog([NSString stringWithFormat:@"--- launch mode %@ noBar %d, iOS %@ %@", self.mode, self.noBar, [UIDevice currentDevice].systemVersion, [UIDevice currentDevice].model]);
    if ([self.mode hasPrefix:@"app"]) {
        [self.web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"capacitor://localhost/index.html"]]];
    } else {
        NSURL *page = [[NSBundle mainBundle].bundleURL URLByAppendingPathComponent:@"test.html"];
        [self.web loadFileURL:page allowingReadAccessToURL:[NSBundle mainBundle].bundleURL];
    }
    for (NSNumber *t in @[@0.05, @0.4, @1.2, @3.0, @6.0]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(t.doubleValue * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [self dump:[NSString stringWithFormat:@"t+%.2f", t.doubleValue] full:t.doubleValue > 2.5 && t.doubleValue < 4]; });
    }
    if ([self.mode hasPrefix:@"safari"]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [self showSafari]; });
    }
    if ([self.mode hasPrefix:@"app"]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(7.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [self appMetrics:@"app t+7"]; });
    }
    if (self.evalJS.length) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(8.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self.web evaluateJavaScript:self.evalJS completionHandler:^(id r, NSError *e) { plog([NSString stringWithFormat:@"eval -> %@ %@", r, e ? e.localizedDescription : @""]); }];
        });
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(11.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [self appMetrics:@"app after eval"]; });
    }
}
- (void)appMetrics:(NSString *)tag {
    NSString *js = @"(function () { function r(sel) { var el = document.querySelector(sel); if (!el) return null; var b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), el.hidden ? 'hidden' : '']; }"
        "var cs = getComputedStyle(document.documentElement); var p = document.createElement('div'); p.style.cssText = 'position:fixed;visibility:hidden;top:0;left:0;height:env(safe-area-inset-top,0px);width:env(safe-area-inset-right,0px)'; document.body.appendChild(p); var st = p.offsetHeight, sr = p.offsetWidth; p.remove();"
        "return JSON.stringify({ w: innerWidth, h: innerHeight, cls: document.body.className, bandH: cs.getPropertyValue('--band-h'), safeTop: st, safeRight: sr, band: r('#band'), search: r('.searchbar'), radar: r('.radar-ctl'), sheet: r('#sheet'), snap: (document.querySelector('#sheet') || {}).dataset ? document.querySelector('#sheet').dataset.snap : null, menuBtn: r('#menu-btn'), map: r('#map'), locate: r('#locate'), title: (document.querySelector('#title') || {}).textContent }); })()";
    [self.web evaluateJavaScript:js completionHandler:^(id r, NSError *e) { plog([NSString stringWithFormat:@"[%@] %@ %@", tag, r, e ? e.localizedDescription : @""]); }];
}
- (void)showSafari {
    NSURL *u = [NSURL URLWithString:@"https://svptjcclszprsmjoldaz.supabase.co/auth/v1/authorize?provider=google&redirect_to=com.surviveastorm.shelterfinder%3A%2F%2Fauth"];
    SFSafariViewController *s = [[SFSafariViewController alloc] initWithURL:u];
    s.delegate = self;
    if ([self.mode isEqualToString:@"safari-popover"]) {
        // exactly what Capacitor's Browser plugin does for presentationStyle "popover"
        s.modalPresentationStyle = UIModalPresentationPopover;
        s.popoverPresentationController.sourceRect = CGRectMake(self.view.center.x, self.view.center.y, 0, 0);
        s.popoverPresentationController.sourceView = self.view;
        s.popoverPresentationController.permittedArrowDirections = 0;
    } else if ([self.mode isEqualToString:@"safari-sheet"]) {
        s.modalPresentationStyle = UIModalPresentationPageSheet;
    } else {
        s.modalPresentationStyle = UIModalPresentationFullScreen;
    }
    plog([NSString stringWithFormat:@"presenting Safari, style %ld", (long)s.modalPresentationStyle]);
    [self presentViewController:s animated:YES completion:^{
        plog([NSString stringWithFormat:@"presented: safari view %@ in window %@, presentation %ld, adaptive %ld", rct([s.view convertRect:s.view.bounds toView:nil]), rct(self.view.window.bounds), (long)s.modalPresentationStyle, (long)s.presentationController.adaptivePresentationStyle]);
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(7.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        plog([NSString stringWithFormat:@"later: safari view %@ preferredContentSize %.0fx%.0f", rct([s.view convertRect:s.view.bounds toView:nil]), s.preferredContentSize.width, s.preferredContentSize.height]);
    });
}
- (void)safariViewController:(SFSafariViewController *)controller didCompleteInitialLoad:(BOOL)didLoadSuccessfully { plog([NSString stringWithFormat:@"safari didCompleteInitialLoad %d", didLoadSuccessfully]); }
- (void)safariViewController:(SFSafariViewController *)controller initialLoadDidRedirectToURL:(NSURL *)URL { plog([NSString stringWithFormat:@"safari redirect to host %@", URL.host]); }
- (void)dump:(NSString *)tag full:(BOOL)full {
    UIView *v = self.view; UIWindow *w = v.window; UIWindowScene *ws = w.windowScene; UITraitCollection *tc = self.traitCollection;
    NSMutableString *s = [NSMutableString stringWithFormat:@"[%@] view %@ safe %@ | window %@ safe %@ | margins %@", tag, rct(v.bounds), ins(v.safeAreaInsets), rct(w.bounds), ins(w.safeAreaInsets), ins(v.layoutMargins)];
    [s appendFormat:@" | sizeClass h%ld v%ld idiom %ld verticalBarEdge %ld", (long)tc.horizontalSizeClass, (long)tc.verticalSizeClass, (long)tc.userInterfaceIdiom, (long)tc.verticalBarEdge];
    [s appendFormat:@" | statusBar %@ hidden %d", rct(ws.statusBarManager.statusBarFrame), ws.statusBarManager.isStatusBarHidden];
    [s appendFormat:@" | screen %@ @%.0fx scene %@ orientation %ld", rct(ws.screen.bounds), ws.screen.scale, rct(ws.coordinateSpace.bounds), (long)ws.effectiveGeometry.interfaceOrientation];
    plog(s);
    NSArray *kinds = @[[UIViewReservedRegionKind occlusionRegionKind], [UIViewReservedRegionKind divisionRegionKind]];
    for (UIViewReservedRegionKind *k in kinds) {
        NSArray<UIViewReservedRegion *> *regs = [v reservedRegionsOfKind:k options:UIViewReservedRegionQueryOptionsIncludeInactive];
        NSMutableArray *parts = [NSMutableArray array];
        for (UIViewReservedRegion *r in regs) [parts addObject:[NSString stringWithFormat:@"{frame %@ margins %@ active %d id %@}", rct(r.frame), ins(r.margins), r.isActive, r.identifier]];
        plog([NSString stringWithFormat:@"[%@] reserved %@: %lu %@", tag, k, (unsigned long)regs.count, [parts componentsJoinedByString:@" "]]);
    }
    Class LR = NSClassFromString(@"UIViewLayoutRegion");
    SEL mk = NSSelectorFromString(@"safeAreaLayoutRegionWithCornerAdaptation:"), mk2 = NSSelectorFromString(@"marginsLayoutRegionWithCornerAdaptation:"), get = NSSelectorFromString(@"edgeInsetsForLayoutRegion:");
    if (LR && [v respondsToSelector:get]) {
        for (NSValue *sv in @[[NSValue valueWithPointer:mk], [NSValue valueWithPointer:mk2]]) {
            SEL make = (SEL)sv.pointerValue;
            if (![LR respondsToSelector:make]) { plog([NSString stringWithFormat:@"no +%@", NSStringFromSelector(make)]); continue; }
            NSMutableArray *parts = [NSMutableArray array];
            for (NSInteger axis = 0; axis <= 2; axis++) {
                id region = ((id (*)(id, SEL, NSInteger))objc_msgSend)(LR, make, axis);
                UIEdgeInsets e = ((UIEdgeInsets (*)(id, SEL, id))objc_msgSend)(v, get, region);
                [parts addObject:[NSString stringWithFormat:@"axis%ld {%@}", (long)axis, ins(e)]];
            }
            plog([NSString stringWithFormat:@"[%@] %@ %@", tag, NSStringFromSelector(make), [parts componentsJoinedByString:@" "]]);
        }
    } else plog(@"no UIViewLayoutRegion insets API");
    if (full) {
        for (Class c in @[[UIView class], [UIViewController class], [UIWindowScene class], [UITraitCollection class], [UIStatusBarManager class], [UIScreen class], [UIWindow class], [WKWebView class], [UINavigationItem class]]) listSelectors(c, NO);
        listSelectors(LR, YES); listSelectors([UIViewReservedRegionKind class], YES);
    }
}
- (void)viewSafeAreaInsetsDidChange { [super viewSafeAreaInsetsDidChange]; plog([NSString stringWithFormat:@"viewSafeAreaInsetsDidChange -> %@ (bounds %@)", ins(self.view.safeAreaInsets), rct(self.view.bounds)]); }
- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    NSString *now = [NSString stringWithFormat:@"%@ safe %@", rct(self.view.bounds), ins(self.view.safeAreaInsets)];
    if (![now isEqualToString:self.lastLayout]) { self.lastLayout = now; plog([NSString stringWithFormat:@"layout %@", now]); }
}
- (void)traitCollectionDidChange:(UITraitCollection *)previous {
    [super traitCollectionDidChange:previous];
    plog([NSString stringWithFormat:@"traits h%ld v%ld verticalBarEdge %ld", (long)self.traitCollection.horizontalSizeClass, (long)self.traitCollection.verticalSizeClass, (long)self.traitCollection.verticalBarEdge]);
}
- (void)userContentController:(WKUserContentController *)c didReceiveScriptMessage:(WKScriptMessage *)m { plog([NSString stringWithFormat:@"web: %@", m.body]); }
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation { plog(@"web didFinishNavigation"); }
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { plog([NSString stringWithFormat:@"web load failed: %@", error.localizedDescription]); }
@end

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
@implementation SceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:[UIWindowScene class]]) return;
    NSArray<NSString *> *args = [NSProcessInfo processInfo].arguments;
    ProbeVC *vc = [ProbeVC new];
    vc.mode = args.count > 1 ? args[1] : @"web";
    vc.noBar = [vc.mode hasSuffix:@"-nobar"];
    for (NSString *a in args) if ([a hasPrefix:@"eval:"]) vc.evalJS = [a substringFromIndex:5];
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.window.rootViewController = vc;
    [self.window makeKeyAndVisible];
}
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation AppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions { gStart = [NSDate date]; return YES; }
- (UISceneConfiguration *)application:(UIApplication *)application configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession options:(UISceneConnectionOptions *)options {
    UISceneConfiguration *c = [[UISceneConfiguration alloc] initWithName:@"Default" sessionRole:connectingSceneSession.role];
    c.delegateClass = [SceneDelegate class];
    return c;
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class])); }
}
