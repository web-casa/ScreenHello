/* Test-only WM_DELETE_WINDOW sender. Compile with cc ... -lX11.
 * Run only inside the runtime test's isolated Xvfb display. */
#include <X11/Xlib.h>
#include <string.h>

static Window find_window(Display *display, Window root) {
    char *name = NULL;
    if (XFetchName(display, root, &name) && name) {
        int match = strcmp(name, "ScreenHello Desktop") == 0 || strcmp(name, "ScreenHello") == 0;
        XFree(name);
        if (match) return root;
    }
    Window parent, returned_root, *children = NULL, found = None;
    unsigned int count = 0;
    if (XQueryTree(display, root, &returned_root, &parent, &children, &count)) {
        for (unsigned int index = 0; index < count && !found; index++)
            found = find_window(display, children[index]);
        if (children) XFree(children);
    }
    return found;
}

int main(void) {
    Display *display = XOpenDisplay(NULL);
    if (!display) return 1;
    Window window = find_window(display, DefaultRootWindow(display));
    if (!window) { XCloseDisplay(display); return 2; }
    XEvent event = {0};
    event.xclient.type = ClientMessage;
    event.xclient.window = window;
    event.xclient.message_type = XInternAtom(display, "WM_PROTOCOLS", False);
    event.xclient.format = 32;
    event.xclient.data.l[0] = XInternAtom(display, "WM_DELETE_WINDOW", False);
    event.xclient.data.l[1] = CurrentTime;
    int sent = XSendEvent(display, window, False, NoEventMask, &event);
    XSync(display, False);
    XCloseDisplay(display);
    return sent ? 0 : 3;
}
