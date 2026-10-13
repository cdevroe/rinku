#import <AppKit/AppKit.h>
#import <SafariServices/SafariServices.h>

static void finish(NSDictionary *result, int code) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    exit(code);
}

static NSString *setupError(NSError *error) {
    if ([error.domain isEqualToString:SFErrorDomain] && error.code == SFErrorNoExtensionFound) {
        return @"Safari has not found the Rinku extension. Open the installed Rinku app from Applications, then reopen Safari and try again.";
    }
    return error.localizedDescription ?: @"Safari has not registered the extension yet.";
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2 || (strcmp(argv[1], "status") && strcmp(argv[1], "open-settings"))) {
            finish(@{@"error": @"Expected status or open-settings."}, 2);
        }
        NSString *identifier = @"com.cdevroe.rinku.SafariExtension";
        if (!strcmp(argv[1], "status")) {
            [SFSafariExtensionManager getStateOfSafariExtensionWithIdentifier:identifier completionHandler:^(SFSafariExtensionState *state, NSError *error) {
                if (error || !state) finish(@{@"enabled": @NO, @"error": setupError(error)}, 0);
                finish(@{@"enabled": @(state.enabled)}, 0);
            }];
        } else {
            [SFSafariApplication showPreferencesForExtensionWithIdentifier:identifier completionHandler:^(NSError *error) {
                if (error) finish(@{@"error": setupError(error)}, 1);
                finish(@{@"ok": @YES}, 0);
            }];
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 12 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            finish(@{@"error": @"Safari did not respond. Open Safari > Settings > Extensions and enable Rinku."}, 1);
        });
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
