#import <Foundation/Foundation.h>
#import "CaptureURL.h"

int main(void) {
    @autoreleasepool {
        NSString *address = @"https://example.com/a?term=a+b&other=hello%20world#part";
        NSString *title = @"C++ & cafés / 日本語 #1";
        NSURL *capture = RinkuCaptureURL([NSURL URLWithString:address], title);
        NSURLComponents *components = [NSURLComponents componentsWithURL:capture resolvingAgainstBaseURL:NO];
        NSMutableDictionary *values = [NSMutableDictionary dictionary];
        for (NSURLQueryItem *item in components.queryItems) values[item.name] = item.value;
        if (![values[@"url"] isEqualToString:address] || ![values[@"title"] isEqualToString:title] || [components.percentEncodedQuery containsString:@"+"]) return 1;
        for (NSString *invalid in @[@"file:///tmp/document", @"javascript:alert(1)", @"about:blank", @"https:"]) {
            if (RinkuCaptureURL([NSURL URLWithString:invalid], @"No") != nil) return 2;
        }
        if (RinkuCaptureURL(nil, nil) != nil) return 3;
        NSURL *withoutTitle = RinkuCaptureURL([NSURL URLWithString:@"http://example.com/"], nil);
        if (!withoutTitle || ![withoutTitle.absoluteString hasSuffix:@"&title="]) return 4;
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"captureURL": capture.absoluteString, @"url": address, @"title": title} options:0 error:nil];
        fwrite(data.bytes, 1, data.length, stdout);
        fputc('\n', stdout);
    }
    return 0;
}
