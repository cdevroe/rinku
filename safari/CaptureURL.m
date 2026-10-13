#import "CaptureURL.h"

NSURL *RinkuCaptureURL(NSURL *pageURL, NSString *title) {
    NSString *scheme = pageURL.scheme.lowercaseString;
    if (!([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"]) || !pageURL.host.length) return nil;
    // Encode '+' as well: Rinku uses URLSearchParams, which treats a raw '+' as a space.
    NSCharacterSet *safe = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"];
    NSString *encodedURL = [pageURL.absoluteString stringByAddingPercentEncodingWithAllowedCharacters:safe];
    NSString *encodedTitle = [(title ?: @"") stringByAddingPercentEncodingWithAllowedCharacters:safe];
    return [NSURL URLWithString:[NSString stringWithFormat:@"rinku://capture?url=%@&title=%@", encodedURL, encodedTitle]];
}
