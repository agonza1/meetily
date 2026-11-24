#include <CoreAudio/CoreAudio.h>
#include <libproc.h>
#include <string.h>
#include <unistd.h>

// Only merge helpers inside the same outer app bundle and parent chain.
static int bundle(pid_t pid, char *path) {
    if (proc_pidpath(pid, path, PROC_PIDPATHINFO_MAXSIZE) <= 0) return 0;
    char *end = strstr(path, ".app/");
    if (!end) return 0;
    end[4] = 0;
    return 1;
}

static pid_t family(pid_t pid, const char *own) {
    char app[PROC_PIDPATHINFO_MAXSIZE], parent[PROC_PIDPATHINFO_MAXSIZE];
    if (!bundle(pid, app) || !strcmp(app, own)) return 0;
    pid_t root = pid;
    for (unsigned depth = 0; pid > 1 && depth < 64; depth++) {
        if (pid == getpid()) return 0;
        struct proc_bsdinfo info;
        if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) return 0;
        pid = info.pbi_ppid;
        if (bundle(pid, parent) && !strcmp(app, parent)) root = pid;
    }
    return pid <= 1 ? root : 0;
}

static int scalar(AudioObjectID obj, UInt32 selector, UInt32 *out) {
    AudioObjectPropertyAddress addr = {selector, kAudioObjectPropertyScopeGlobal, 0};
    UInt32 size = sizeof(*out);
    return AudioObjectHasProperty(obj, &addr) &&
        !AudioObjectGetPropertyData(obj, &addr, 0, NULL, &size, out) && size == sizeof(*out);
}

struct activity { int32_t family; uint32_t input, output; };

int meetily_process_activity(struct activity *rows, unsigned capacity) {
    AudioObjectPropertyAddress list = {kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyScopeGlobal, 0};
    AudioObjectID ids[512];
    UInt32 size = sizeof(ids);
    if (!AudioObjectHasProperty(kAudioObjectSystemObject, &list)) return -1;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &list, 0, NULL, &size) || size > sizeof(ids)) return -2;
    if (!size) return 0;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &list, 0, NULL, &size, ids) || size > sizeof(ids)) return -2;
    char own[PROC_PIDPATHINFO_MAXSIZE] = {0};
    bundle(getpid(), own);
    unsigned count = 0;
    for (unsigned i = 0; i < size / sizeof(*ids); i++) {
        UInt32 pid, input, output;
        if (!scalar(ids[i], kAudioProcessPropertyPID, &pid)) return -2;
        int root = family((pid_t)pid, own);
        if (!root) continue;
        if (!scalar(ids[i], kAudioProcessPropertyIsRunningInput, &input) ||
            !scalar(ids[i], kAudioProcessPropertyIsRunningOutput, &output)) return -2;
        if (!(input || output)) continue;
        if (count >= capacity) return -2;
        rows[count++] = (struct activity){root, input, output};
    }
    return (int)count;
}

// Optional read-only acceptance probe. Print directions for the selected app
// family only; never print other process identities or executable paths.
#ifdef MEETILY_ACTIVITY_PROBE
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    if (argc != 2 || atoi(argv[1]) <= 0) return 2;
    struct activity rows[512];
    int n = meetily_process_activity(rows, 512);
    if (n < 0) { fprintf(stderr, "HAL unavailable (%d)\n", n); return 1; }
    unsigned in = 0, out = 0, matched = 0;
    for (int i = 0; i < n; ++i) if (rows[i].family == atoi(argv[1])) {
        in |= rows[i].input; out |= rows[i].output; ++matched;
        printf("active process: input=%u output=%u\n", rows[i].input, rows[i].output);
    }
    printf("family: active processes=%u input=%u output=%u\n", matched, in, out);
    return 0;
}
#endif
