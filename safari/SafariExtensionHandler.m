#import <AppKit/AppKit.h>
#import <SafariServices/SafariServices.h>
#import "CaptureURL.h"

@interface RinkuSafariExtensionHandler : SFSafariExtensionHandler
@end

@implementation RinkuSafariExtensionHandler

- (void)savePage:(SFSafariPage *)page {
    [page getPagePropertiesWithCompletionHandler:^(SFSafariPageProperties *properties) {
        NSURL *captureURL = RinkuCaptureURL(properties.url, properties.title);
        if (!captureURL) return;
        // Launch this extension's containing Rinku app, even if another build
        // has registered itself as the system's rinku:// handler.
        NSURL *appURL = NSBundle.mainBundle.bundleURL;
        for (NSInteger i = 0; i < 3; i++) appURL = appURL.URLByDeletingLastPathComponent;
        dispatch_async(dispatch_get_main_queue(), ^{
            [[NSWorkspace sharedWorkspace] openURLs:@[captureURL]
                               withApplicationAtURL:appURL
                                      configuration:[NSWorkspaceOpenConfiguration configuration]
                                  completionHandler:^(NSRunningApplication *app, NSError *error) {
                if (error) NSLog(@"Rinku could not open the saved page: %@", error.localizedDescription);
            }];
        });
    }];
}

- (void)toolbarItemClickedInWindow:(SFSafariWindow *)window {
    [window getActiveTabWithCompletionHandler:^(SFSafariTab *tab) {
        [tab getActivePageWithCompletionHandler:^(SFSafariPage *page) {
            if (page) [self savePage:page];
        }];
    }];
}

- (void)contextMenuItemSelectedWithCommand:(NSString *)command inPage:(SFSafariPage *)page userInfo:(NSDictionary *)userInfo {
    if ([command isEqualToString:@"save-page"]) [self savePage:page];
}

- (void)validateToolbarItemInWindow:(SFSafariWindow *)window validationHandler:(void (^)(BOOL, NSString *))validationHandler {
    [window getActiveTabWithCompletionHandler:^(SFSafariTab *tab) {
        [tab getActivePageWithCompletionHandler:^(SFSafariPage *page) {
            if (!page) { validationHandler(NO, @""); return; }
            [page getPagePropertiesWithCompletionHandler:^(SFSafariPageProperties *properties) {
                // Keep the button available when Safari hasn't granted website
                // access yet; clicking it lets Safari request permission.
                validationHandler(!properties.url || RinkuCaptureURL(properties.url, nil) != nil, @"");
            }];
        }];
    }];
}

- (void)validateContextMenuItemWithCommand:(NSString *)command inPage:(SFSafariPage *)page userInfo:(NSDictionary *)userInfo validationHandler:(void (^)(BOOL, NSString *))validationHandler {
    [page getPagePropertiesWithCompletionHandler:^(SFSafariPageProperties *properties) {
        validationHandler(RinkuCaptureURL(properties.url, nil) == nil, nil);
    }];
}
@end
