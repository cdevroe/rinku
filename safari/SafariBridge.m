#import <AppKit/AppKit.h>
#import <SafariServices/SafariServices.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    bool enabled;
    bool setup;
    char *error;
} RinkuSafariReply;

// Safari checks the calling app's identity. This module runs in Electron's main
// process, so the caller is the containing Rinku app rather than a helper tool.
static void deliver(napi_env env, napi_value callback, void *context, void *data) {
    RinkuSafariReply *reply = data;
    if (env) {
        napi_value result, value;
        napi_create_object(env, &result);
        napi_get_boolean(env, reply->setup ? !reply->error : reply->enabled, &value);
        napi_set_named_property(env, result, reply->setup ? "ok" : "enabled", value);
        if (reply->error) {
            napi_create_string_utf8(env, reply->error, NAPI_AUTO_LENGTH, &value);
            napi_set_named_property(env, result, "error", value);
        }
        napi_resolve_deferred(env, (napi_deferred)context, result);
    }
    free(reply->error);
    free(reply);
}

@interface RinkuSafariRequest : NSObject {
@public
    napi_threadsafe_function callback;
    BOOL completed;
    BOOL setup;
}
- (void)finishEnabled:(BOOL)enabled error:(NSString *)error;
@end

@implementation RinkuSafariRequest
- (void)finishEnabled:(BOOL)enabled error:(NSString *)error {
    // Both completion and timeout arrive here on the main queue. Exactly one
    // may resolve the promise, even if Safari answers after the timeout.
    if (completed) return;
    completed = YES;
    RinkuSafariReply *reply = calloc(1, sizeof(RinkuSafariReply));
    reply->enabled = enabled;
    reply->setup = setup;
    reply->error = error ? strdup(error.UTF8String) : NULL;
    if (napi_call_threadsafe_function(callback, reply, napi_tsfn_nonblocking) != napi_ok) {
        free(reply->error);
        free(reply);
    }
    napi_release_threadsafe_function(callback, napi_tsfn_release);
}
@end

static NSString *setupError(NSError *error) {
    if ([error.domain isEqualToString:SFErrorDomain] && error.code == SFErrorNoExtensionFound) {
        return @"Safari has not registered Rinku yet. Open Safari > Settings > Extensions. If Rinku is missing, quit and reopen Safari.";
    }
    return error.localizedDescription ?: @"Safari could not check the Rinku extension.";
}

static napi_value invoke(napi_env env, BOOL setup) {
    napi_deferred deferred;
    napi_value promise, name;
    if (napi_create_promise(env, &deferred, &promise) != napi_ok ||
        napi_create_string_utf8(env, "RinkuSafariServices", NAPI_AUTO_LENGTH, &name) != napi_ok) {
        napi_throw_error(env, NULL, "Could not create the Safari setup request.");
        return NULL;
    }
    RinkuSafariRequest *request = [RinkuSafariRequest new];
    request->setup = setup;
    if (napi_create_threadsafe_function(env, NULL, NULL, name, 1, 1, NULL, NULL,
        deferred, deliver, &request->callback) != napi_ok) {
        napi_throw_error(env, NULL, "Could not create the Safari setup callback.");
        return NULL;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *identifier = @"com.cdevroe.rinku.SafariExtension";
        if (setup) {
            [SFSafariApplication showPreferencesForExtensionWithIdentifier:identifier completionHandler:^(NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [request finishEnabled:NO error:error ? setupError(error) : nil];
                });
            }];
        } else {
            [SFSafariExtensionManager getStateOfSafariExtensionWithIdentifier:identifier completionHandler:^(SFSafariExtensionState *state, NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [request finishEnabled:state.enabled error:(error || !state) ? setupError(error) : nil];
                });
            }];
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 12 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            [request finishEnabled:NO error:@"Safari did not respond. Open Safari > Settings > Extensions and enable Rinku."];
        });
    });
    return promise;
}

static napi_value status(napi_env env, napi_callback_info info) { return invoke(env, NO); }
static napi_value openSettings(napi_env env, napi_callback_info info) { return invoke(env, YES); }
static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor methods[] = {
        {"status", NULL, status, NULL, NULL, NULL, napi_default, NULL},
        {"openSettings", NULL, openSettings, NULL, NULL, NULL, napi_default, NULL},
    };
    napi_define_properties(env, exports, 2, methods);
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
