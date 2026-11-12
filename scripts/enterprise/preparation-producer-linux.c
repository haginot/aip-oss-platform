/* Prospective producer helper: read-only host preflight, not a launcher.
 * No command, PID, domain path, JSON or environment variable grants authority.
 * All observations are untrusted diagnostics. Even on Linux, exit 78 until
 * the private controller, protected supervisor and native protocol exist.
 * Do not install setuid or use this output as PRODUCTION_DOMAIN_CLOSED.
 * Interfaces: docs.kernel.org/admin-guide/cgroup-v2.html and
 * docs.kernel.org/filesystems/proc.html. No cgroup/control file is written.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/utsname.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <dirent.h>
#include <unistd.h>
#include <poll.h>
#include <time.h>
#include <signal.h>
#include <sys/wait.h>
#ifdef __linux__
#include <sys/vfs.h>
#endif


/* Historical digest-only owner composition is available only to an isolated
 * compile-time primitive harness. No environment, wire value or CLI argument
 * enables it. Normal owner entries refuse until the complete retained semantic
 * context and native pre-GO composition are implemented. Lower-level storage
 * and transport remain private building blocks, not an alternative authority.
 * Requiring a renamed main prevents this mode from building the normal helper.
 */
#if defined(PD_LEGACY_OWNER_TEST) && !defined(main)
#error "PD_LEGACY_OWNER_TEST requires an isolated harness with renamed main"
#endif

/* Private admission storage primitive; not a ProducerDomainPort or authority.
 * Only a future authenticated protected supervisor may supply its held store
 * directory and digest of the complete run/attempt/start/generation descriptor.
 * No CLI, environment or workload channel reaches these functions. A stored
 * ADMITTED record is NOT membership/policy proof and never sends GO.
 *
 * A separate immutable intent and commit make a torn transition blocking.
 * Failed writes are never truncated, removed, retried or adopted here. flock
 * serializes independent supervisor handles; it is not host exclusion and is
 * not a replacement for P's durable fence. Read-only inspection only reports
 * recorded state, never proves durability after an interrupted invocation.
 * Native controller integration and authenticated crash continuation remain.
 */
enum pd_phase { PD_EMPTY = 0, PD_PREPARED = 1, PD_ADMITTED = 2, PD_CLOSED = 3 };
#define PD_RECORD_SIZE 75
static const char *const pd_names[3][2] = {
    {"prepared.intent", "prepared.commit"},
    {"admitted.intent", "admitted.commit"},
    {"closed.intent", "closed.commit"}
};

static inline int pd_error(int code) { errno = code; return -1; }
static inline int pd_binding_valid(const char *binding)
{
    if (!binding || strlen(binding) != 64) return pd_error(EINVAL);
    for (size_t i = 0; i < 64; ++i)
        if (!((binding[i] >= '0' && binding[i] <= '9') ||
              (binding[i] >= 'a' && binding[i] <= 'f'))) return pd_error(EINVAL);
    return 0;
}
static inline int pd_directory(int fd)
{
    struct stat s;
    if (fstat(fd, &s) < 0) return -1;
    if (!S_ISDIR(s.st_mode) || s.st_uid != geteuid() ||
        (s.st_mode & 07777) != 0700 || s.st_nlink == 0) return pd_error(EPERM);
    return 0;
}
static inline void pd_record(char out[PD_RECORD_SIZE], const char *binding,
                             int previous, int next)
{
    /* Fixed bytes, no C struct padding, native endian or permissive parser. */
    memcpy(out, "PDA1\n", 5); out[5] = (char)('0' + previous);
    out[6] = '>'; out[7] = (char)('0' + next); out[8] = '\n';
    memcpy(out + 9, binding, 64); out[73] = '\n'; out[74] = '\n';
}
static inline int pd_read_record(int dir, const char *name, char out[PD_RECORD_SIZE])
{
    int fd = openat(dir, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return errno == ENOENT ? 0 : -1;
    struct stat s, after, path; int error = 0; size_t used = 0;
    if (fstat(fd, &s) < 0) error = errno;
    else if (!S_ISREG(s.st_mode) || s.st_uid != geteuid() ||
             (s.st_mode & 07777) != 0600 || s.st_nlink != 1 ||
             s.st_size != PD_RECORD_SIZE) error = EINVAL;
    while (!error && used < PD_RECORD_SIZE) {
        ssize_t n = read(fd, out + used, PD_RECORD_SIZE - used);
        if (n < 0) { if (errno == EINTR) continue; error = errno; }
        else if (!n) error = EIO;
        else used += (size_t)n;
    }
    if (!error && (fstat(fd, &after) < 0 || fstatat(dir, name, &path, AT_SYMLINK_NOFOLLOW) < 0)) error = errno;
    if (!error && (after.st_size != s.st_size || after.st_nlink != 1 ||
                  path.st_dev != s.st_dev || path.st_ino != s.st_ino ||
                  path.st_mode != s.st_mode || path.st_uid != s.st_uid)) error = ESTALE;
    if (close(fd) < 0 && !error) error = errno;
    return error ? pd_error(error) : 1;
}
static inline int pd_names_valid(int dir)
{
    /* New open description avoids sharing the caller's directory seek offset. */
    int scanfd = openat(dir, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (scanfd < 0) return -1;
    DIR *entries = fdopendir(scanfd);
    if (!entries) { int error = errno; close(scanfd); return pd_error(error); }
    int error = 0; struct dirent *entry;
    for (;;) {
        errno = 0; entry = readdir(entries);
        if (!entry) { error = errno; break; }
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        int known = 0;
        for (int i = 0; i < 3; ++i) for (int j = 0; j < 2; ++j)
            if (!strcmp(entry->d_name, pd_names[i][j])) known = 1;
        if (!known) { error = EINVAL; break; }
    }
    if (closedir(entries) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
}
static inline int pd_scan(int dir, const char *binding, int *phase)
{
    if (pd_binding_valid(binding) < 0 || pd_directory(dir) < 0 || pd_names_valid(dir) < 0) return -1;
    int state = PD_EMPTY;
    for (int next = PD_PREPARED; next <= PD_CLOSED; ++next) {
        char intent[PD_RECORD_SIZE], commit[PD_RECORD_SIZE], expected[PD_RECORD_SIZE];
        int a = pd_read_record(dir, pd_names[next-1][0], intent);
        if (a < 0) return -1;
        int b = pd_read_record(dir, pd_names[next-1][1], commit);
        if (b < 0) return -1;
        if (a != b) return pd_error(EINPROGRESS);
        if (!a) continue;
        if ((next == PD_ADMITTED && state != PD_PREPARED) ||
            (next == PD_CLOSED && state == PD_EMPTY)) return pd_error(EINVAL);
        pd_record(expected, binding, state, next);
        if (memcmp(intent, expected, PD_RECORD_SIZE) || memcmp(commit, expected, PD_RECORD_SIZE))
            return pd_error(EINVAL);
        state = next;
    }
    *phase = state; return 0;
}
/* Pin existing inodes for the entire transition: raw bytes alone cannot
 * detect replacement by an equal record. These descriptors are supervisor-only
 * and must never be inherited by a workload. This is not host exclusion. */
struct pd_checkpoint {
    int held[6];
    struct stat identity[6];
    char bytes[6][PD_RECORD_SIZE];
};
static inline void pd_checkpoint_init(struct pd_checkpoint *c)
{
    for (int i = 0; i < 6; ++i) c->held[i] = -1;
}
static inline int pd_checkpoint_close(struct pd_checkpoint *c)
{
    int error = 0;
    for (int i = 0; i < 6; ++i) if (c->held[i] >= 0) {
        if (close(c->held[i]) < 0 && !error) error = errno;
        c->held[i] = -1;
    }
    return error ? pd_error(error) : 0;
}
static inline int pd_checkpoint_check(int dir, const struct pd_checkpoint *c)
{
    if (pd_directory(dir) < 0 || pd_names_valid(dir) < 0) return -1;
    for (int i = 0; i < 6; ++i) {
        const char *name = pd_names[i/2][i%2];
        struct stat path, held; char bytes[PD_RECORD_SIZE];
        int exists = pd_read_record(dir, name, bytes);
        if (exists < 0) return -1;
        if (c->held[i] < 0) { if (exists) return pd_error(ESTALE); continue; }
        if (!exists) return pd_error(ESTALE);
        if (fstat(c->held[i], &held) < 0 || fstatat(dir, name, &path, AT_SYMLINK_NOFOLLOW) < 0) return -1;
        const struct stat *original = &c->identity[i];
        if (path.st_dev != original->st_dev || path.st_ino != original->st_ino ||
            held.st_nlink != 1 || held.st_mode != original->st_mode ||
            held.st_uid != original->st_uid || held.st_gid != original->st_gid ||
            held.st_size != original->st_size || memcmp(bytes, c->bytes[i], PD_RECORD_SIZE))
            return pd_error(ESTALE);
    }
    return 0;
}
static inline int pd_checkpoint_capture(int dir, struct pd_checkpoint *c)
{
    for (int i = 0; i < 6; ++i) {
        const char *name = pd_names[i/2][i%2];
        c->held[i] = openat(dir, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
        if (c->held[i] < 0) { if (errno == ENOENT) continue; return -1; }
        if (fstat(c->held[i], &c->identity[i]) < 0) return -1;
        int result = pd_read_record(dir, name, c->bytes[i]);
        if (result < 0) return -1;
        if (!result) return pd_error(ESTALE);
    }
    return pd_checkpoint_check(dir, c);
}
static inline int pd_write_record(int dir, const char *name, const char record[PD_RECORD_SIZE],
                                  int *held, struct stat *identity)
{
    int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    struct stat original, current; int error = 0; size_t used = 0;
    int pin = fcntl(fd, F_DUPFD_CLOEXEC, 0);
    if (pin < 0) error = errno;
    if (!error && fstat(fd, &original) < 0) error = errno;
    while (!error && used < PD_RECORD_SIZE) {
        ssize_t n = write(fd, record + used, PD_RECORD_SIZE - used);
        if (n < 0) { if (errno == EINTR) continue; error = errno; break; }
        if (!n) { error = EIO; break; }
        used += (size_t)n;
    }
    if (!error && fsync(fd) < 0) error = errno;
    if (close(fd) < 0 && !error) error = errno;
    if (!error && fsync(dir) < 0) error = errno;
    if (!error && fstatat(dir, name, &current, AT_SYMLINK_NOFOLLOW) < 0) error = errno;
    if (!error && (original.st_dev != current.st_dev || original.st_ino != current.st_ino)) error = ESTALE;
    char actual[PD_RECORD_SIZE];
    if (!error) {
        int result = pd_read_record(dir, name, actual);
        if (result < 0) error = errno;
        else if (result != 1 || memcmp(actual, record, PD_RECORD_SIZE)) error = EIO;
    }
    if (!error && fstat(pin, identity) < 0) error = errno;
    if (error) { if (pin >= 0) (void)close(pin); return pd_error(error); }
    *held = pin;
    return 0;
}
/* Kept private and intentionally unreachable from the preflight-only CLI. */
static inline int __attribute__((unused)) pd_admission_inspect(int dir, const char *binding, int *phase)
{
    if (pd_directory(dir) < 0 || flock(dir, LOCK_SH | LOCK_NB) < 0) return -1;
    int result = pd_scan(dir, binding, phase), error = result < 0 ? errno : 0;
    if (flock(dir, LOCK_UN) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
}
/* Requires the caller's exclusive store lock; leaves pinned records owned by
 * the caller until the whole operation (including a possible GO) is finished. */
static inline int pd_admission_transition_pinned(int dir, const char *binding,
        int expected, int next, struct pd_checkpoint *checkpoint)
{
    int state = -1, error = 0;
    if (pd_checkpoint_check(dir, checkpoint) < 0) error = errno;
    /* Held history, not a newly adopted equal record, authorizes the transition. */
    if (!error && pd_scan(dir, binding, &state) < 0) error = errno;
    if (!error && state != expected) error = ESTALE;
    char record[PD_RECORD_SIZE]; pd_record(record, binding, expected, next);
    for (int part = 0; !error && part < 2; ++part) {
        int slot = (next-1)*2 + part;
        if (pd_checkpoint_check(dir, checkpoint) < 0) { error = errno; break; }
        if (pd_write_record(dir, pd_names[next-1][part], record,
                            &checkpoint->held[slot], &checkpoint->identity[slot]) < 0) { error = errno; break; }
        memcpy(checkpoint->bytes[slot], record, PD_RECORD_SIZE);
        if (pd_checkpoint_check(dir, checkpoint) < 0) error = errno;
    }
    if (!error && pd_scan(dir, binding, &state) < 0) error = errno;
    if (!error && state != next) error = EIO;
    if (!error && pd_checkpoint_check(dir, checkpoint) < 0) error = errno;
    return error ? pd_error(error) : 0;
}
static inline int pd_admission_transition_locked(int dir, const char *binding,
        int expected, int next, struct pd_checkpoint *checkpoint)
{
    if (pd_checkpoint_capture(dir, checkpoint) < 0) return -1;
    return pd_admission_transition_pinned(dir, binding, expected, next, checkpoint);
}
static inline int __attribute__((unused)) pd_admission_append(int dir, const char *binding, int expected, int next)
{
    if (!((expected == PD_EMPTY && next == PD_PREPARED) ||
          (expected == PD_PREPARED && (next == PD_ADMITTED || next == PD_CLOSED)) ||
          (expected == PD_ADMITTED && next == PD_CLOSED))) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_directory(dir) < 0 || flock(dir, LOCK_EX | LOCK_NB) < 0) return -1;
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int error = pd_admission_transition_locked(dir, binding, expected, next, &checkpoint) < 0 ? errno : 0;
    if (pd_checkpoint_close(&checkpoint) < 0 && !error) error = errno;
    if (flock(dir, LOCK_UN) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
}

/* Private pre-exec FD filtering primitive, NOT a sandbox or launch authority.
 * Called only in a future protected, single-threaded setup child with no
 * concurrent FD operations (including signal handlers). The authenticated
 * supervisor must build the inventory from its own held descriptors and prove
 * pipe peers/input provenance separately. Caller records cannot authorize GO.
 * No CLI reaches this routine. On ANY failure the setup child must terminate;
 * closing descriptors is intentionally irreversible, never a reason to exec.
 */
#define PD_FD_KEEP_MAX 64
#define PD_FD_SCAN_MAX 4096
enum pd_fd_role { PD_INPUT_READ = 1, PD_PIPE_READ = 2, PD_PIPE_WRITE = 3 };
struct pd_fd_entry { int fd; enum pd_fd_role role; struct stat identity; };
static inline int pd_fd_matches(const struct pd_fd_entry *e)
{
    struct stat now;
    if (e->fd < 0) return pd_error(EBADF);
    if (fstat(e->fd, &now) < 0) return -1;
    int flags = fcntl(e->fd, F_GETFL, 0);
    if (flags < 0) return -1;
#ifdef O_PATH
    if (flags & O_PATH) return pd_error(EPERM);
#endif
    int access = flags & O_ACCMODE;
    if (!((e->role == PD_INPUT_READ && S_ISREG(now.st_mode) && access == O_RDONLY) ||
          (e->role == PD_PIPE_READ && S_ISFIFO(now.st_mode) && access == O_RDONLY) ||
          (e->role == PD_PIPE_WRITE && S_ISFIFO(now.st_mode) && access == O_WRONLY)))
        return pd_error(EPERM);
    const struct stat *old = &e->identity;
    if (now.st_dev != old->st_dev || now.st_ino != old->st_ino ||
        now.st_mode != old->st_mode || now.st_uid != old->st_uid ||
        now.st_gid != old->st_gid || now.st_nlink != old->st_nlink ||
        /* Pipe occupancy is mutable transport state, not descriptor identity. */
        (S_ISREG(now.st_mode) && now.st_size != old->st_size)) return pd_error(ESTALE);
    return 0;
}
static inline int pd_fd_inventory_valid(const struct pd_fd_entry *keep, size_t count)
{
    if (count > PD_FD_KEEP_MAX || (count && !keep)) return pd_error(EINVAL);
    for (size_t i = 0; i < count; ++i) {
        for (size_t j = 0; j < i; ++j) if (keep[i].fd == keep[j].fd) return pd_error(EINVAL);
        if (pd_fd_matches(&keep[i]) < 0) return -1;
    }
    return 0;
}
static inline int pd_fd_kept(int fd, const struct pd_fd_entry *keep, size_t count)
{
    for (size_t i = 0; i < count; ++i) if (keep[i].fd == fd) return 1;
    return 0;
}
static inline int pd_fd_snapshot(int fds[PD_FD_SCAN_MAX], size_t *count)
{
    /* Enumerate open descriptors, not RLIMIT_NOFILE: a lowered limit can leave
     * already-open descriptors above it. Do not guess a maximum or fallback.
     * The native supervisor must authenticate the proc/dev mount separately. */
#ifdef __linux__
    const char *path = "/proc/self/fd";
#elif defined(__APPLE__)
    const char *path = "/dev/fd";
#else
    (void)fds; (void)count; return pd_error(ENOTSUP);
#endif
#if defined(__linux__) || defined(__APPLE__)
    int fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return -1;
    DIR *dir = fdopendir(fd);
    if (!dir) { int error = errno; (void)close(fd); return pd_error(error); }
    int error = 0; *count = 0;
    for (;;) {
        errno = 0; struct dirent *entry = readdir(dir);
        if (!entry) { error = errno; break; }
        const char *name = entry->d_name;
        if (!strcmp(name, ".") || !strcmp(name, "..")) continue;
        unsigned value = 0;
        for (size_t i = 0; name[i]; ++i) {
            if (name[i] < '0' || name[i] > '9' || value > (2147483647U - (unsigned)(name[i]-'0')) / 10U) { error = EINVAL; break; }
            value = value * 10U + (unsigned)(name[i]-'0');
        }
        if (error) break;
        if ((int)value == fd) continue;
        if (*count == PD_FD_SCAN_MAX) { error = EOVERFLOW; break; }
        if (fcntl((int)value, F_GETFD, 0) < 0) { error = errno; break; }
        fds[(*count)++] = (int)value;
    }
    if (closedir(dir) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
#endif
}
static inline int pd_fd_filter(const struct pd_fd_entry *keep, size_t count, int control_fd)
{
    if (pd_fd_inventory_valid(keep, count) < 0) return -1;
    int fds[PD_FD_SCAN_MAX]; size_t found = 0;
    if (pd_fd_snapshot(fds, &found) < 0 || pd_fd_inventory_valid(keep, count) < 0) return -1;
    for (size_t i = 0; i < found; ++i) if (!pd_fd_kept(fds[i], keep, count)) {
        /* Do not retry close(EINTR): on some platforms the number is free. */
        if (close(fds[i]) < 0) return -1;
    }
    if (pd_fd_inventory_valid(keep, count) < 0) return -1;
    for (size_t i = 0; i < count; ++i) {
        int flags = fcntl(keep[i].fd, F_GETFD, 0);
        if (flags < 0) return -1;
        int next = keep[i].fd == control_fd ? flags | FD_CLOEXEC : flags & ~FD_CLOEXEC;
        if (fcntl(keep[i].fd, F_SETFD, next) < 0) return -1;
    }
    if (pd_fd_snapshot(fds, &found) < 0) return -1;
    if (found != count) return pd_error(ESTALE);
    for (size_t i = 0; i < found; ++i) if (!pd_fd_kept(fds[i], keep, count)) return pd_error(ESTALE);
    return pd_fd_inventory_valid(keep, count);
}
static inline int __attribute__((unused)) pd_fd_prepare_exec(const struct pd_fd_entry *keep, size_t count)
{
    return pd_fd_filter(keep, count, -1);
}

/* Private one-shot setup-channel receiver, not an authenticated GO authority.
 * A protected supervisor must first durably admit the exact descriptor and
 * verify membership/policy, then send this frame through its private pipe and
 * close every write end. The binding must come from trusted setup state, never
 * workload argv or JSON. Those supervisor/Port integrations are not implemented.
 * This runs before untrusted exec in the same non-concurrent setup child as FD
 * filtering. EOF is mandatory: partial, duplicate or trailing messages refuse.
 * Success consumes/closes the channel; every failure requires child termination.
 * No CLI reaches this primitive and a valid frame alone proves no containment.
 */
#define PD_GO_SIZE 71
static inline int pd_go_remaining(const struct timespec *start, int timeout_ms)
{
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
    if (now.tv_sec < start->tv_sec ||
        (now.tv_sec == start->tv_sec && now.tv_nsec < start->tv_nsec)) return pd_error(ESTALE);
    if (now.tv_sec - start->tv_sec > 60) return pd_error(ETIMEDOUT);
    long long ns = (long long)(now.tv_sec - start->tv_sec) * 1000000000LL + now.tv_nsec - start->tv_nsec;
    long long left = (long long)timeout_ms * 1000000LL - ns;
    if (left <= 0) return pd_error(ETIMEDOUT);
    return (int)((left + 999999LL) / 1000000LL);
}
static inline int pd_go_channel_valid(const struct pd_fd_entry *channel)
{
    if (!channel || channel->role != PD_PIPE_READ) return pd_error(EINVAL);
    if (pd_fd_matches(channel) < 0) return -1;
    int flags = fcntl(channel->fd, F_GETFL, 0);
    if (flags < 0) return -1;
    int inherited = fcntl(channel->fd, F_GETFD, 0);
    if (inherited < 0) return -1;
    if (!(flags & O_NONBLOCK) || !(inherited & FD_CLOEXEC)) return pd_error(EPERM);
    return 0;
}
static inline int __attribute__((unused)) pd_go_wait(const struct pd_fd_entry *channel,
                                                     const char *binding, int timeout_ms)
{
    if (timeout_ms <= 0 || timeout_ms > 60000) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_go_channel_valid(channel) < 0) return -1;
    char expected[PD_GO_SIZE], received[PD_GO_SIZE + 1]; size_t used = 0;
    memcpy(expected, "PDGO1\n", 6); memcpy(expected + 6, binding, 64); expected[70] = '\n';
    struct timespec start;
    if (clock_gettime(CLOCK_MONOTONIC, &start) < 0) return -1;
    for (;;) {
        int remaining = pd_go_remaining(&start, timeout_ms);
        if (remaining < 0 || pd_go_channel_valid(channel) < 0) return -1;
        struct pollfd p = {.fd = channel->fd, .events = POLLIN, .revents = 0};
        int ready = poll(&p, 1, remaining);
        if (ready < 0) { if (errno == EINTR) continue; return -1; }
        if (pd_go_remaining(&start, timeout_ms) < 0 || pd_go_channel_valid(channel) < 0) return -1;
        if (!ready) continue;
        if (p.revents & POLLNVAL) return pd_error(EBADF);
        if ((p.revents & ~(POLLIN | POLLHUP)) || !(p.revents & (POLLIN | POLLHUP))) return pd_error(EIO);
        ssize_t n = read(channel->fd, received + used, sizeof(received) - used);
        if (n < 0) { if (errno == EINTR || errno == EAGAIN) continue; return -1; }
        if (pd_go_remaining(&start, timeout_ms) < 0 || pd_go_channel_valid(channel) < 0) return -1;
        if (!n) {
            if (used != PD_GO_SIZE) return pd_error(EPROTO);
            /* No retry on close(EINTR), and never exec after a close failure. */
            return close(channel->fd);
        }
        used += (size_t)n;
        if (used > PD_GO_SIZE || memcmp(received, expected, used)) return pd_error(EPROTO);
    }
}

/* Private composition of FD confinement and GO transport, not a launcher.
 * The future authenticated supervisor must supply both inventories and install
 * membership/credential/mount/syscall policy before this non-concurrent child
 * waits here. No callback, CLI or caller-supplied record grants those powers.
 * The control pipe is retained only during setup, always close-on-exec; no
 * alias of either end may appear in the workload inventory. The supervisor
 * must provide both ends of its own pipe pair: some kernels give the two ends
 * different inode identities. These checks do not authenticate their pairing.
 * The child copy of the write end is closed before waiting. After GO consumes
 * it, verify rather than repair the remaining set: unexpected post-GO handles
 * or changed inheritance flags must fail, not be silently cleaned up.
 * Every error requires setup-child termination, with no exec or retry.
 */
static inline int __attribute__((unused)) pd_setup_wait(const struct pd_fd_entry *workload,
        size_t count, const struct pd_fd_entry *channel, const struct pd_fd_entry *sender,
        const char *binding, int timeout_ms)
{
    if (count >= PD_FD_KEEP_MAX || timeout_ms <= 0 || timeout_ms > 60000) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_go_channel_valid(channel) < 0 ||
        pd_fd_inventory_valid(workload, count) < 0) return -1;
    if (!sender || sender->role != PD_PIPE_WRITE || sender->fd == channel->fd) return pd_error(EINVAL);
    if (pd_fd_matches(sender) < 0) return -1;
    struct pd_fd_entry setup[PD_FD_KEEP_MAX];
    for (size_t i = 0; i < count; ++i) {
        if (workload[i].fd == channel->fd || workload[i].fd == sender->fd ||
            (workload[i].identity.st_dev == channel->identity.st_dev &&
             workload[i].identity.st_ino == channel->identity.st_ino) ||
            (workload[i].identity.st_dev == sender->identity.st_dev &&
             workload[i].identity.st_ino == sender->identity.st_ino)) return pd_error(EINVAL);
        setup[i] = workload[i];
    }
    setup[count] = *channel;
    if (pd_fd_filter(setup, count + 1, channel->fd) < 0 ||
        pd_go_wait(channel, binding, timeout_ms) < 0) return -1;
    int fds[PD_FD_SCAN_MAX]; size_t found = 0;
    if (pd_fd_snapshot(fds, &found) < 0 || pd_fd_inventory_valid(workload, count) < 0) return -1;
    if (found != count) return pd_error(ESTALE);
    for (size_t i = 0; i < found; ++i)
        if (!pd_fd_kept(fds[i], workload, count)) return pd_error(ESTALE);
    for (size_t i = 0; i < count; ++i) {
        int flags = fcntl(workload[i].fd, F_GETFD, 0);
        if (flags < 0) return -1;
        if (flags & FD_CLOEXEC) return pd_error(ESTALE);
    }
    return 0;
}

/* Private control-pipe construction for the future protected supervisor.
 * Construct both endpoints here, never infer pairing from inode equality.
 * The caller must initialize both result FDs to -1 and serialize creation
 * against fork/exec and all FD operations, including signal handlers. pipe +
 * fcntl is NOT atomic against a concurrent fork. No workload may run yet.
 * Publish only the fully checked pair. Failure leaves result untouched and
 * closes owned endpoints once, preserving the first error. A cleanup failure
 * can leave a descriptor open; every failure requires setup-process exit.
 * This establishes local pipe creation only, not supervisor authentication,
 * durable admission, GO permission or native containment. No CLI reaches it.
 */
struct pd_control_pipe { struct pd_fd_entry receiver, sender; };
static inline int __attribute__((unused)) pd_control_pipe_open(struct pd_control_pipe *result)
{
    if (!result || result->receiver.fd != -1 || result->sender.fd != -1)
        return pd_error(EINVAL);
    int fds[2];
    if (pipe(fds) < 0) return -1;
    struct pd_control_pipe pair = {
        .receiver = {.fd = fds[0], .role = PD_PIPE_READ},
        .sender = {.fd = fds[1], .role = PD_PIPE_WRITE}
    };
    int error = 0;
    for (int i = 0; i < 2 && !error; ++i) {
        int flags = fcntl(fds[i], F_GETFD, 0);
        if (flags < 0 || fcntl(fds[i], F_SETFD, flags | FD_CLOEXEC) < 0) { error = errno; break; }
        flags = fcntl(fds[i], F_GETFL, 0);
        if (flags < 0 || fcntl(fds[i], F_SETFL, flags | O_NONBLOCK) < 0) { error = errno; break; }
    }
    if (!error && (fstat(fds[0], &pair.receiver.identity) < 0 ||
                   fstat(fds[1], &pair.sender.identity) < 0)) error = errno;
    if (!error && (pd_go_channel_valid(&pair.receiver) < 0 || pd_fd_matches(&pair.sender) < 0)) error = errno;
    if (!error) {
        int flags = fcntl(fds[1], F_GETFL, 0);
        if (flags < 0) error = errno;
        else {
            int inherited = fcntl(fds[1], F_GETFD, 0);
            if (inherited < 0) error = errno;
            else if (!(flags & O_NONBLOCK) || !(inherited & FD_CLOEXEC)) error = EPERM;
        }
    }
    if (error) {
        (void)close(fds[0]); (void)close(fds[1]);
        return pd_error(error);
    }
    *result = pair;
    return 0;
}

/* Private one-shot GO transport, NOT admission or launch authority.
 * The future protected supervisor must authenticate membership/policy and
 * durably record ADMITTED before calling this, under its admission exclusion.
 * No public CLI reaches it. Sender and binding come from trusted setup state.
 * Requires serialized FD operations and SIGPIPE ignored by the supervisor;
 * this function never changes process-wide signal disposition itself.
 * Consume the handle BEFORE one nonblocking write; never retry even EINTR or
 * EAGAIN. A short write leaves an invalid frame which the receiver rejects.
 * Once write is attempted, failures are delivery-unknown: in particular a
 * close error may follow a complete frame and actual EOF/exec at the receiver.
 * Do not translate an error to NOT_EXECUTED, resend, or roll back admission.
 * On error the supervisor must enter authenticated stop/reconciliation; if
 * close failed the descriptor may remain open. No close retry is safe here.
 * COMPLETE means frame written and sender closed, not workload completion.
 * This in-memory consumption does not provide crash/restart replay protection.
 */
enum pd_go_delivery { PD_GO_NOT_ATTEMPTED = 0, PD_GO_UNKNOWN = 1, PD_GO_COMPLETE = 2 };
static inline int __attribute__((unused)) pd_go_publish(struct pd_fd_entry *sender,
        const char *binding, enum pd_go_delivery *delivery)
{
    if (!delivery) return pd_error(EINVAL);
    *delivery = PD_GO_NOT_ATTEMPTED;
    if (!sender || sender->role != PD_PIPE_WRITE) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_fd_matches(sender) < 0) return -1;
    int flags = fcntl(sender->fd, F_GETFL, 0);
    if (flags < 0) return -1;
    int inherited = fcntl(sender->fd, F_GETFD, 0);
    if (inherited < 0) return -1;
    if (!(flags & O_NONBLOCK) || !(inherited & FD_CLOEXEC)) return pd_error(EPERM);
    struct sigaction action;
    if (sigaction(SIGPIPE, NULL, &action) < 0) return -1;
    if (action.sa_handler != SIG_IGN) return pd_error(EPERM);
    char frame[PD_GO_SIZE];
    memcpy(frame, "PDGO1\n", 6); memcpy(frame + 6, binding, 64); frame[70] = '\n';
    int fd = sender->fd; sender->fd = -1;
    *delivery = PD_GO_UNKNOWN;
    ssize_t n = write(fd, frame, sizeof(frame));
    int error = n < 0 ? errno : (n != PD_GO_SIZE ? EIO : 0);
    if (close(fd) < 0 && !error) error = errno;
    if (error) return pd_error(error);
    *delivery = PD_GO_COMPLETE;
    return 0;
}

/* Private storage/transport composition, not authenticated admission authority.
 * The future protected supervisor must already have verified the descriptor,
 * membership and complete policy under its own admission exclusion. This local
 * lock serializes cooperating store handles only, not host actors. Keep record
 * pins and the exclusive lock through GO; closeAdmission cannot interleave.
 * Only a fresh PREPARED -> ADMITTED transition can send. Existing ADMITTED,
 * CLOSED, or torn records never authorize a retry, even with a new pipe/handle.
 * Crash after ADMITTED but before GO therefore remains blocking, not replayable.
 * A transport/prevalidation/cleanup failure never removes admission records.
 * Delivery is this invocation's transport result, not historical execution
 * status. Even COMPLETE plus cleanup failure requires stop/reconciliation;
 * NOT_ATTEMPTED on a retry cannot describe the previous invocation's outcome.
 * No public CLI, caller token or callback reaches this operation.
 */
static inline int __attribute__((unused)) pd_admission_publish(int dir, const char *binding,
        struct pd_fd_entry *sender, enum pd_go_delivery *delivery)
{
    if (!delivery) return pd_error(EINVAL);
    *delivery = PD_GO_NOT_ATTEMPTED;
    if (!sender || sender->role != PD_PIPE_WRITE) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_directory(dir) < 0 ||
        flock(dir, LOCK_EX | LOCK_NB) < 0) return -1;
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int error = pd_admission_transition_locked(dir, binding, PD_PREPARED, PD_ADMITTED, &checkpoint) < 0 ? errno : 0;
    if (!error && pd_go_publish(sender, binding, delivery) < 0) error = errno;
    if (pd_checkpoint_close(&checkpoint) < 0 && !error) error = errno;
    if (flock(dir, LOCK_UN) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
}

/* Private cancellation of a PREPARED setup, not workload stop or recovery.
 * The authenticated supervisor must supply its own pending sender and exact
 * descriptor binding, with no concurrent FD operations. Never accept an
 * ADMITTED generation here: GO may already have reached a running workload.
 * Persist CLOSED under the same exclusion as publication before consuming the
 * pending sender. Keep record pins/lock until the close has been attempted.
 * Failure preserves all records; it never authorizes retry, GO or rollback.
 * Before sender consumption a failure leaves it owned by the caller; after
 * consumption close can fail with the FD still open. The setup owner must
 * terminate/reconcile on any error; no close retry or numeric-FD adoption.
 * Success proves this local transition/close only, not setup reaping, complete
 * domain emptiness, durable native proof or supervisor authentication.
 * No CLI, caller token or callback reaches this operation.
 */
static inline int pd_pending_sender_valid(const struct pd_fd_entry *sender)
{
    if (!sender || sender->role != PD_PIPE_WRITE) return pd_error(EINVAL);
    if (pd_fd_matches(sender) < 0) return -1;
    int flags = fcntl(sender->fd, F_GETFL, 0);
    if (flags < 0) return -1;
    int inherited = fcntl(sender->fd, F_GETFD, 0);
    if (inherited < 0) return -1;
    if (!(flags & O_NONBLOCK) || !(inherited & FD_CLOEXEC)) return pd_error(EPERM);
    return 0;
}
static inline int __attribute__((unused)) pd_admission_cancel(int dir, const char *binding,
        struct pd_fd_entry *sender)
{
    if (pd_binding_valid(binding) < 0 || pd_pending_sender_valid(sender) < 0 ||
        pd_directory(dir) < 0 || flock(dir, LOCK_EX | LOCK_NB) < 0) return -1;
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int error = pd_admission_transition_locked(dir, binding, PD_PREPARED, PD_CLOSED, &checkpoint) < 0 ? errno : 0;
    if (!error && pd_pending_sender_valid(sender) < 0) error = errno;
    if (!error) {
        int fd = sender->fd; sender->fd = -1;
        if (close(fd) < 0) error = errno;
    }
    if (pd_checkpoint_close(&checkpoint) < 0 && !error) error = errno;
    if (flock(dir, LOCK_UN) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
}

/* Private bounded reaping of one original, unreaped direct setup child.
 * Only the future authenticated supervisor may supply a PID retained directly
 * from its own fork. No PID lookup/adoption, public CLI or persisted numeric PID
 * is an identity proof. The owner must serialize fork/wait and signal changes,
 * with no other waiter, tracer, SIGCHLD handler or automatic child reaping.
 * Under that precondition the unreaped child pins the PID until waitpid consumes
 * its terminal status. Timeout/error is not death, cancellation or domain empty.
 * Never signal, use waitpid(-1), change signal disposition, or reap descendants.
 * ECHILD invalidates this handle but reports failure: no exit is reconstructed.
 * Success consumes the handle and returns the actual wait status, including
 * nonzero exits and signals. It does not prove that no workload ever executed.
 * A post-reap clock check must not discard an already consumed kernel status.
 */
static inline int pd_setup_reap_valid(const pid_t *child, int timeout_ms)
{
    if (!child || *child <= 0 || *child == getpid() ||
        timeout_ms <= 0 || timeout_ms > 60000) return pd_error(EINVAL);
    struct sigaction action;
    if (sigaction(SIGCHLD, NULL, &action) < 0) return -1;
    if (action.sa_handler != SIG_DFL || (action.sa_flags & SA_NOCLDWAIT))
        return pd_error(EPERM);
    return 0;
}
static inline int __attribute__((unused)) pd_setup_reap(pid_t *child, int timeout_ms,
                                                       int *status)
{
    if (!status) return pd_error(EINVAL);
    if (pd_setup_reap_valid(child, timeout_ms) < 0) return -1;
    struct timespec start;
    if (clock_gettime(CLOCK_MONOTONIC, &start) < 0) return -1;
    for (;;) {
        int remaining = pd_go_remaining(&start, timeout_ms);
        if (remaining < 0) return -1;
        int observed = 0;
        pid_t got = waitpid(*child, &observed, WNOHANG);
        if (got < 0) {
            int error = errno;
            if (error == ECHILD) *child = -1;
            if (error == EINTR) continue;
            return pd_error(error);
        }
        if (got) {
            if (got != *child || (!WIFEXITED(observed) && !WIFSIGNALED(observed)))
                return pd_error(EPROTO);
            *child = -1; *status = observed; return 0;
        }
        remaining = pd_go_remaining(&start, timeout_ms);
        if (remaining < 0) return -1;
        struct timespec delay = {.tv_sec = 0,
            .tv_nsec = (remaining < 10 ? remaining : 10) * 1000000L};
        if (nanosleep(&delay, NULL) < 0 && errno != EINTR) return -1;
    }
}

/* Private PREPARED cancellation plus observation of the original direct child.
 * The same ownership, non-concurrent setup and authenticated store/FD/binding
 * preconditions as cancel/reap apply. No PID adoption or supervisor authority
 * is established here. Validate wait policy before any cancellation write.
 * After attempting cancellation, always attempt bounded reaping, even when
 * cancellation failed: this is observation only, never a signal or GO retry.
 * Preserve both errors and any consumed terminal status. Reaping a child which
 * executed after an earlier GO cannot make a rejected cancellation succeed.
 * A partial CLOSED record, unconsumed sender or failed close stays untouched;
 * the caller must retain ownership and reconcile it. Never roll back or resend.
 * timeout_ms bounds only the reaping phase, not storage/fsync latency. The
 * cancellation cleanup is attempted before waiting. A failed unlock may leave
 * the cooperating-store lock held during this bounded wait; the owner must
 * reconcile that lock too. Do not report release merely from reaching reap.
 * Success is local cancellation plus direct-child reaping, NOT domain empty,
 * successful workload completion, crash continuation or a native certificate.
 */
struct pd_cancel_reap_result {
    int cancel_attempted, cancel_error;
    int reap_attempted, reap_error;
    int status_valid, status;
};
static inline int __attribute__((unused)) pd_setup_cancel_reap(int dir,
        const char *binding, struct pd_fd_entry *sender, pid_t *child,
        int timeout_ms, struct pd_cancel_reap_result *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_cancel_reap_result){0};
    if (pd_setup_reap_valid(child, timeout_ms) < 0 ||
        pd_binding_valid(binding) < 0 || pd_pending_sender_valid(sender) < 0 ||
        pd_directory(dir) < 0) return -1;
    result->cancel_attempted = 1;
    if (pd_admission_cancel(dir, binding, sender) < 0) result->cancel_error = errno;
    result->reap_attempted = 1;
    int observed = 0;
    if (pd_setup_reap(child, timeout_ms, &observed) < 0) result->reap_error = errno;
    else { result->status = observed; result->status_valid = 1; }
    int error = result->cancel_error ? result->cancel_error : result->reap_error;
    return error ? pd_error(error) : 0;
}

/* Private pre-fork resource reservation, not native domain reservation.
 * The protected supervisor must supply its authenticated store and complete
 * descriptor digest and serialize all FD/fork operations. This routine neither
 * creates a domain nor authenticates that descriptor or grants GO authority.
 * Construct a private pipe, then durably append a fresh EMPTY -> PREPARED.
 * Return the pair only after storage/readback and cleanup have all succeeded.
 * Existing or torn records refuse; response loss never permits a second pair
 * to be adopted as the original reservation. No fork or workload runs here.
 * Failure leaves result unchanged and preserves partial/complete records.
 * Close each locally owned endpoint once, preserving the storage error. A
 * failed close/unlock may leave resources owned: caller must exit/reconcile,
 * never fork, retry close by number, erase records, or infer successful reserve.
 */
static inline int __attribute__((unused)) pd_setup_reserve(int dir,
        const char *binding, struct pd_control_pipe *result)
{
    if (!result || result->receiver.fd != -1 || result->sender.fd != -1)
        return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_directory(dir) < 0) return -1;
    struct pd_control_pipe pair = {.receiver = {.fd = -1}, .sender = {.fd = -1}};
    if (pd_control_pipe_open(&pair) < 0) return -1;
    if (pd_admission_append(dir, binding, PD_EMPTY, PD_PREPARED) < 0) {
        int error = errno;
        (void)close(pair.receiver.fd); (void)close(pair.sender.fd);
        return pd_error(error);
    }
    *result = pair;
    return 0;
}

/* Private fork/ownership handoff for trusted setup code, NOT a launcher.
 * The future protected supervisor must have durably reserved this exact pair
 * and descriptor and serialize fork, FD operations, wait and signal changes.
 * No arbitrary PID, callback, argv or CLI is accepted. This routine does not
 * authenticate reservation, install membership/policy, send GO or run workload.
 * Return 0 only in the child, which retains both original endpoints and must
 * install the native boundary before pd_setup_wait and any untrusted exec.
 * Return 1 in the parent after closing its receiver copy. Publish the actual
 * fork PID BEFORE that fallible close: on -1 with a positive child, the parent
 * still owns a live/unreaped setup child and must cancel/reconcile/reap it.
 * Consume the receiver handle before close, with no EINTR retry. A close error
 * may leave its FD open; never fork again, resend GO or adopt that number.
 * On prevalidation/fork failure leave both handles untouched. The sender stays
 * parent-owned for cancellation/admission. No signal disposition is changed.
 * Child return is trusted setup only, not proof of native confinement or GO.
 */
static inline int __attribute__((unused)) pd_setup_fork(struct pd_control_pipe *pair,
                                                       pid_t *child)
{
    if (!pair || !child || *child != -1 || pair->receiver.fd == pair->sender.fd)
        return pd_error(EINVAL);
    if (pd_go_channel_valid(&pair->receiver) < 0 ||
        pd_pending_sender_valid(&pair->sender) < 0) return -1;
    struct sigaction action;
    if (sigaction(SIGCHLD, NULL, &action) < 0) return -1;
    if (action.sa_handler != SIG_DFL || (action.sa_flags & SA_NOCLDWAIT))
        return pd_error(EPERM);
    pid_t created = fork();
    if (created < 0) return -1;
    if (!created) return 0;
    *child = created;
    int fd = pair->receiver.fd; pair->receiver.fd = -1;
    if (close(fd) < 0) return -1;
    return 1;
}

/* Private durable reservation followed by trusted setup fork, NOT a launcher.
 * The future protected supervisor supplies the authenticated store/descriptor
 * and serializes FD, fork, wait and signal operations throughout this call.
 * Validate output ownership and wait policy before any reservation write.
 * Reserve publishes its pipe only after PREPARED and cleanup are durable and
 * successful; a failed reservation cannot reach fork. After reservation,
 * retain the pair even if fork fails so the owner can cancel without retrying
 * reserve or erasing history. A positive child on error must also be reaped.
 * Return conventions and child obligations are those of pd_setup_fork. No
 * automatic cancellation, GO, exec, PID adoption or failure rollback occurs.
 * The child is trusted setup only: native membership/policy and durable helper
 * identity must be established before admission/GO by the future supervisor.
 * This is not atomic against another store owner or host actors, and does not
 * provide authenticated restart continuation or an operation-wide deadline.
 */
static inline int __attribute__((unused)) pd_setup_begin(int dir,
        const char *binding, struct pd_control_pipe *pair, pid_t *child)
{
    if (!pair || !child || *child != -1 ||
        pair->receiver.fd != -1 || pair->sender.fd != -1) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_directory(dir) < 0) return -1;
    struct sigaction action;
    if (sigaction(SIGCHLD, NULL, &action) < 0) return -1;
    if (action.sa_handler != SIG_DFL || (action.sa_flags & SA_NOCLDWAIT))
        return pd_error(EPERM);
    if (pd_setup_reserve(dir, binding, pair) < 0) return -1;
    return pd_setup_fork(pair, child);
}

/* Private cancellation of a reservation whose pipe is still wholly owned by
 * the supervisor: no fork/handoff may have occurred. The caller must establish
 * that ownership from its own execution, never from a missing/reused PID.
 * Authenticate store/binding and serialize FD operations in the future Port.
 * Under the admission lock, persist PREPARED -> CLOSED before consuming either
 * endpoint. Revalidate both identities after storage. Keep pins/lock through
 * both close attempts, and retain both close errors plus the first errno.
 * A failed transition/check leaves both endpoints untouched. Once closing
 * starts, consume each handle before its single close attempt; no EINTR retry.
 * Failure can leave FDs or the store lock open and requires owner reconciliation.
 * Records are never erased or rolled back; CLOSED never licenses a new GO.
 * Success proves this transition and the two local close calls only, not child
 * absence, empty domain, native containment or restart recovery. No CLI entry.
 */
struct pd_reserved_cancel_result {
    int close_attempted;
    int receiver_error, sender_error;
};
static inline int __attribute__((unused)) pd_setup_cancel_reserved(int dir,
        const char *binding, struct pd_control_pipe *pair,
        struct pd_reserved_cancel_result *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_reserved_cancel_result){0};
    if (!pair || pair->receiver.fd == pair->sender.fd) return pd_error(EINVAL);
    if (pd_binding_valid(binding) < 0 || pd_go_channel_valid(&pair->receiver) < 0 ||
        pd_pending_sender_valid(&pair->sender) < 0 || pd_directory(dir) < 0 ||
        flock(dir, LOCK_EX | LOCK_NB) < 0) return -1;
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int error = pd_admission_transition_locked(dir, binding, PD_PREPARED, PD_CLOSED, &checkpoint) < 0 ? errno : 0;
    if (!error && (pd_go_channel_valid(&pair->receiver) < 0 ||
                   pd_pending_sender_valid(&pair->sender) < 0)) error = errno;
    if (!error) {
        result->close_attempted = 1;
        int fd = pair->receiver.fd; pair->receiver.fd = -1;
        if (close(fd) < 0) result->receiver_error = errno;
        fd = pair->sender.fd; pair->sender.fd = -1;
        if (close(fd) < 0) result->sender_error = errno;
        error = result->receiver_error ? result->receiver_error : result->sender_error;
    }
    if (pd_checkpoint_close(&checkpoint) < 0 && !error) error = errno;
    if (flock(dir, LOCK_UN) < 0 && !error) error = errno;
    return error ? pd_error(error) : 0;
}

/* Private, single-owner in-process setup lifecycle. This is bookkeeping for
 * trusted supervisor code, NOT an authority token or a restartable handle.
 * Never deserialize, copy/adopt, or concurrently use this object. The caller
 * authenticates the store/descriptor, retains the borrowed directory FD, and
 * serializes all FD, fork, wait and signal operations. The PID check only
 * rejects an inherited child's copy; it is not supervisor authentication.
 * Begin is single-use once reservation is attempted. Unknown reservation
 * failure requires reconciliation, not a new begin. Keep the original error
 * even when cancellation succeeds. A fork error with no child retains both
 * endpoints; a parent close error with a child routes to cancellation/reaping.
 * Cancellation is attempted at most once. Failed cleanup keeps its errors and
 * remaining handles for explicit reconciliation, never automatic retry/GO.
 * The borrowed store's held identity and copied binding select cancellation;
 * caller-supplied replacement store/binding/PID are not accepted by cancel.
 * CANCELLED records only the selected cancellation's success. It never clears
 * begin_error or proves that a failed begin close/unlock released its resource;
 * those unresolved resources still require the original owner's reconciliation.
 * This is not child absence beyond the observed
 * direct child, domain empty, native policy, durable identity or crash recovery.
 */
enum pd_setup_stage {
    PD_SETUP_NEW, PD_SETUP_UNRESOLVED, PD_SETUP_RESERVED, PD_SETUP_PARENT,
    PD_SETUP_CHILD, PD_SETUP_CANCELLED, PD_SETUP_CANCEL_FAILED,
    PD_SETUP_PUBLISHED, PD_SETUP_PUBLISH_FAILED,
    PD_SETUP_WAITED, PD_SETUP_WAIT_FAILED
};
struct pd_setup_owner {
    enum pd_setup_stage stage;
    /* Separate from publication/observation: closure cannot repair either. */
    enum { PD_SETUP_CLOSE_NEW, PD_SETUP_CLOSE_FAILED, PD_SETUP_CLOSED } closure;
    pid_t owner, child, setup_process;
    int store, begin_error, sender_release_attempted;
    struct stat store_identity;
    char binding[65];
    struct pd_control_pipe pipe;
};
#define PD_SETUP_OWNER_INITIALIZER {.stage = PD_SETUP_NEW, .child = -1, \
    .store = -1, .pipe = {.receiver = {.fd = -1}, .sender = {.fd = -1}}}
struct pd_setup_cleanup {
    int attempted, error;
    struct pd_reserved_cancel_result reserved;
    struct pd_cancel_reap_result child;
};
static inline int __attribute__((unused)) pd_setup_owner_begin(int dir,
        const char *binding, struct pd_setup_owner *owner)
{
#ifndef PD_LEGACY_OWNER_TEST
    (void)dir; (void)binding; (void)owner;
    return pd_error(EPERM);
#else
    if (!owner || owner->stage != PD_SETUP_NEW || owner->closure != PD_SETUP_CLOSE_NEW ||
        owner->sender_release_attempted ||
        owner->owner != 0 || owner->setup_process != 0 ||
        owner->store != -1 || owner->child != -1 ||
        owner->pipe.receiver.fd != -1 || owner->pipe.sender.fd != -1)
        return pd_error(EINVAL);
    struct stat identity;
    if (pd_binding_valid(binding) < 0 || pd_directory(dir) < 0 ||
        fstat(dir, &identity) < 0) return -1;
    owner->owner = getpid(); owner->store = dir; owner->store_identity = identity;
    memcpy(owner->binding, binding, sizeof(owner->binding));
    owner->stage = PD_SETUP_UNRESOLVED;
    int result = pd_setup_begin(dir, owner->binding, &owner->pipe, &owner->child);
    owner->begin_error = result < 0 ? errno : 0;
    if (!result) { owner->stage = PD_SETUP_CHILD; owner->setup_process = getpid(); }
    else if (owner->child > 0) owner->stage = PD_SETUP_PARENT;
    else if (owner->pipe.receiver.fd >= 0 && owner->pipe.sender.fd >= 0)
        owner->stage = PD_SETUP_RESERVED;
    if (result < 0) errno = owner->begin_error;
    return result;
#endif
}
static inline int __attribute__((unused)) pd_setup_owner_cancel(
        struct pd_setup_owner *owner, int timeout_ms, struct pd_setup_cleanup *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_setup_cleanup){0};
    if (!owner || timeout_ms <= 0 || timeout_ms > 60000) return pd_error(EINVAL);
    if (owner->owner != getpid()) return pd_error(EPERM);
    enum pd_setup_stage stage = owner->stage;
    if (stage != PD_SETUP_RESERVED && stage != PD_SETUP_PARENT) return pd_error(ESTALE);
    struct stat identity;
    if (pd_directory(owner->store) < 0 || fstat(owner->store, &identity) < 0) return -1;
    if (identity.st_dev != owner->store_identity.st_dev ||
        identity.st_ino != owner->store_identity.st_ino) return pd_error(ESTALE);
    owner->stage = PD_SETUP_CANCEL_FAILED; result->attempted = 1;
    int r = stage == PD_SETUP_RESERVED
        ? pd_setup_cancel_reserved(owner->store, owner->binding, &owner->pipe, &result->reserved)
        : pd_setup_cancel_reap(owner->store, owner->binding, &owner->pipe.sender,
                              &owner->child, timeout_ms, &result->child);
    if (r < 0) { result->error = errno; return -1; }
    owner->stage = PD_SETUP_CANCELLED;
    return 0;
}


/* Private one-shot publication through the original parent's setup state.
 * The protected supervisor must authenticate the complete descriptor, helper
 * identity, membership and policy BEFORE calling this private composition.
 * This function does not establish those prerequisites or grant GO authority.
 * Only a successful begin with its original store and sender can proceed.
 * Consume the publication opportunity before storage: a failure can leave a
 * partial ADMITTED record, an unknown delivery or a consumed sender. Never
 * retry publication or route such a state through PREPARED cancellation.
 * Keep the original child for observation/stop by its authenticated owner.
 * COMPLETE describes transport only, including when later store cleanup fails.
 * A successful wait cannot repair publication or prove an empty generation.
 * Caller retains this result across observation; no automatic cleanup, signal,
 * rollback, descriptor adoption or public CLI entry is provided.
 */
struct pd_setup_publication {
    int attempted, error;
    enum pd_go_delivery delivery;
};
static inline int __attribute__((unused)) pd_setup_owner_publish(
        struct pd_setup_owner *owner, struct pd_setup_publication *result)
{
#ifndef PD_LEGACY_OWNER_TEST
    (void)owner;
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_setup_publication){0};
    return pd_error(EPERM);
#else
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_setup_publication){0};
    if (!owner) return pd_error(EINVAL);
    if (owner->owner != getpid()) return pd_error(EPERM);
    if (owner->stage != PD_SETUP_PARENT) return pd_error(ESTALE);
    if (owner->begin_error || owner->child <= 0 || owner->child == getpid() ||
        owner->pipe.receiver.fd != -1) return pd_error(EPERM);
    struct stat identity;
    if (pd_binding_valid(owner->binding) < 0 || pd_directory(owner->store) < 0 ||
        fstat(owner->store, &identity) < 0 ||
        pd_pending_sender_valid(&owner->pipe.sender) < 0) return -1;
    if (identity.st_dev != owner->store_identity.st_dev ||
        identity.st_ino != owner->store_identity.st_ino) return pd_error(ESTALE);
    owner->stage = PD_SETUP_PUBLISH_FAILED; result->attempted = 1;
    if (pd_admission_publish(owner->store, owner->binding,
                             &owner->pipe.sender, &result->delivery) < 0) {
        result->error = errno; return -1;
    }
    owner->stage = PD_SETUP_PUBLISHED;
    return 0;
#endif
}

/* Private observation after a failed cancellation or attempted publication.
 * Keep the original stage and begin_error: consuming a terminal child status cannot
 * repair cancellation, admission, close, lock or durability failures. The
 * caller retains the original cleanup result separately. No store/FD cleanup,
 * signal, GO, cancellation retry or PID adoption is performed here.
 * Only the original parent's still-owned direct child may be observed, with
 * the same exclusive-wait/signal-policy preconditions as pd_setup_reap. This
 * in-process object is not authenticated or restartable. Store identity need
 * not be reread for this observation: no storage decision or write is made.
 * Timeout/observation failure leaves the child owned, except ECHILD invalidates
 * it without inventing an exit. A later explicit observation may use that same
 * retained handle; neither a successful wait nor a missing handle proves an
 * empty domain, released resources or successful cancellation. No CLI entry.
 */
struct pd_setup_observation {
    int attempted, error, status_valid, status;
};
static inline int __attribute__((unused)) pd_setup_owner_reap(
        struct pd_setup_owner *owner, int timeout_ms, struct pd_setup_observation *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_setup_observation){0};
    if (!owner) return pd_error(EINVAL);
    if (owner->owner != getpid()) return pd_error(EPERM);
    if (owner->stage != PD_SETUP_CANCEL_FAILED && owner->stage != PD_SETUP_PUBLISHED &&
        owner->stage != PD_SETUP_PUBLISH_FAILED) return pd_error(ESTALE);
    if (pd_setup_reap_valid(&owner->child, timeout_ms) < 0) return -1;
    result->attempted = 1;
    int observed = 0;
    if (pd_setup_reap(&owner->child, timeout_ms, &observed) < 0) {
        result->error = errno; return -1;
    }
    result->status_valid = 1; result->status = observed;
    return 0;
}

/* Private child-side composition through the state returned by the original
 * setup fork. The future supervisor must install and authenticate native
 * membership, credentials, mounts and syscall policy BEFORE this operation.
 * PID checks reject inherited copies; they do not authenticate that policy or
 * authorize exec. No deserialize/adoption, concurrent FD use or public entry.
 * Use the captured binding and pipe endpoints, not replacement caller values.
 * Consume the wait opportunity before FD filtering, which is irreversible.
 * Every attempted failure requires setup-child termination, never retry/exec.
 * The child copy of the borrowed store is among the descriptors filtered out;
 * parent ownership is unchanged. Failed filtering/close can leave descriptors
 * open. Consumed bookkeeping is not proof that those resources were released.
 * WAITED proves only FD/GO protocol checks; it is not native admission proof.
 */
struct pd_setup_wait_result { int attempted, error; };
static inline int __attribute__((unused)) pd_setup_owner_wait(
        struct pd_setup_owner *owner, const struct pd_fd_entry *workload,
        size_t count, int timeout_ms, struct pd_setup_wait_result *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_setup_wait_result){0};
    if (!owner || count >= PD_FD_KEEP_MAX || (count && !workload) ||
        timeout_ms <= 0 || timeout_ms > 60000) return pd_error(EINVAL);
    if (owner->setup_process != getpid() || owner->owner == getpid()) return pd_error(EPERM);
    if (owner->stage != PD_SETUP_CHILD) return pd_error(ESTALE);
    if (owner->begin_error || owner->child != -1) return pd_error(EPERM);
    struct pd_fd_entry receiver = owner->pipe.receiver, sender = owner->pipe.sender;
    owner->stage = PD_SETUP_WAIT_FAILED; result->attempted = 1;
    owner->pipe.receiver.fd = -1; owner->pipe.sender.fd = -1; owner->store = -1;
    if (pd_setup_wait(workload, count, &receiver, &sender, owner->binding, timeout_ms) < 0) {
        result->error = errno; return -1;
    }
    owner->stage = PD_SETUP_WAITED;
    return 0;
}

/* Private post-publication admission closure, not workload stop or sealing.
 * The original parent and authenticated supervisor must retain/serialize the
 * borrowed store, descriptor and all FD operations. No restart/PID adoption.
 * Keep publication stage, begin_error, delivery result and child handle intact.
 * Under the publication lock, select only a complete PREPARED or ADMITTED
 * history. Torn/unknown/already-CLOSED history refuses; never repair or replay.
 * Consume this in-process opportunity before lock/storage; every attempted
 * failure needs authenticated reconciliation, not retry from this object.
 * CLOSED prevents future storage-mediated admission, not a previously sent GO
 * from executing. It is NOT generation empty or output sealing. Retained pipe
 * endpoints, failed close/unlock resources and the original child remain owned
 * for separate stop/reconciliation. No signal, wait, GO or endpoint close here.
 * Fsync/readback and cleanup must all succeed before reporting CLOSED. A
 * complete record followed by cleanup failure still reports CLOSE_FAILED.
 */
struct pd_setup_closure { int attempted, error, previous; };
static inline int __attribute__((unused)) pd_setup_owner_close_admission(
        struct pd_setup_owner *owner, struct pd_setup_closure *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_setup_closure){.previous = -1};
    if (!owner) return pd_error(EINVAL);
    if (owner->owner != getpid()) return pd_error(EPERM);
    if ((owner->stage != PD_SETUP_PUBLISHED && owner->stage != PD_SETUP_PUBLISH_FAILED) ||
        owner->closure != PD_SETUP_CLOSE_NEW) return pd_error(ESTALE);
    struct stat identity;
    if (pd_binding_valid(owner->binding) < 0 || pd_directory(owner->store) < 0 ||
        fstat(owner->store, &identity) < 0) return -1;
    if (identity.st_dev != owner->store_identity.st_dev ||
        identity.st_ino != owner->store_identity.st_ino) return pd_error(ESTALE);
    owner->closure = PD_SETUP_CLOSE_FAILED; result->attempted = 1;
    if (flock(owner->store, LOCK_EX | LOCK_NB) < 0) {
        result->error = errno; return -1;
    }
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int phase = -1, error = 0;
    if (pd_scan(owner->store, owner->binding, &phase) < 0) error = errno;
    else if (phase != PD_PREPARED && phase != PD_ADMITTED) error = ESTALE;
    if (!error) {
        result->previous = phase;
        if (pd_admission_transition_locked(owner->store, owner->binding,
                                           phase, PD_CLOSED, &checkpoint) < 0) error = errno;
    }
    if (pd_checkpoint_close(&checkpoint) < 0 && !error) error = errno;
    if (flock(owner->store, LOCK_UN) < 0 && !error) error = errno;
    if (error) { result->error = error; return pd_error(error); }
    owner->closure = PD_SETUP_CLOSED;
    return 0;
}

/* Private release of the original still-owned sender after successful closure.
 * Required when publication failed before consuming the sender: without EOF a
 * setup child can remain waiting. This is neither cancellation nor workload
 * stop. No already-consumed numeric FD is adopted, and no GO is sent.
 * The authenticated supervisor must serialize borrowed-store/FD operations.
 * Recheck CLOSED history and pin its records under exclusion before close.
 * Consume the operation before acquiring the lock, and the sender before one
 * close attempt. Never retry close(EINTR), even if the descriptor remains open.
 * Preserve publication, closure and child ownership; observation is separate.
 * Any error keeps its evidence and requires reconciliation of remaining FDs
 * and locks. Success proves only this sender close and storage cleanup, not
 * child exit, absence of other writers, domain empty or restart authority.
 */
struct pd_sender_release_result {
    int attempted, close_attempted, close_error, cleanup_error, error;
};
static inline int __attribute__((unused)) pd_setup_owner_release_sender(
        struct pd_setup_owner *owner, struct pd_sender_release_result *result)
{
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_sender_release_result){0};
    if (!owner) return pd_error(EINVAL);
    if (owner->owner != getpid()) return pd_error(EPERM);
    if ((owner->stage != PD_SETUP_PUBLISHED && owner->stage != PD_SETUP_PUBLISH_FAILED) ||
        owner->closure != PD_SETUP_CLOSED || owner->sender_release_attempted)
        return pd_error(ESTALE);
    struct stat identity;
    if (pd_binding_valid(owner->binding) < 0 || pd_directory(owner->store) < 0 ||
        fstat(owner->store, &identity) < 0 ||
        pd_pending_sender_valid(&owner->pipe.sender) < 0) return -1;
    if (identity.st_dev != owner->store_identity.st_dev ||
        identity.st_ino != owner->store_identity.st_ino) return pd_error(ESTALE);
    owner->sender_release_attempted = 1; result->attempted = 1;
    if (flock(owner->store, LOCK_EX | LOCK_NB) < 0) {
        result->error = errno; return -1;
    }
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int phase = -1, error = 0;
    if (pd_scan(owner->store, owner->binding, &phase) < 0) error = errno;
    else if (phase != PD_CLOSED) error = ESTALE;
    if (!error && pd_checkpoint_capture(owner->store, &checkpoint) < 0) error = errno;
    /* Capture may have pinned records changed since the first scan. Validate
     * that pinned history is CLOSED, then detect changes during this scan. */
    if (!error && pd_scan(owner->store, owner->binding, &phase) < 0) error = errno;
    if (!error && phase != PD_CLOSED) error = ESTALE;
    if (!error && pd_checkpoint_check(owner->store, &checkpoint) < 0) error = errno;
    if (!error && pd_pending_sender_valid(&owner->pipe.sender) < 0) error = errno;
    if (!error) {
        int fd = owner->pipe.sender.fd; owner->pipe.sender.fd = -1;
        result->close_attempted = 1;
        if (close(fd) < 0) { result->close_error = errno; error = errno; }
    }
    if (pd_checkpoint_close(&checkpoint) < 0) result->cleanup_error = errno;
    if (flock(owner->store, LOCK_UN) < 0 && !result->cleanup_error)
        result->cleanup_error = errno;
    if (!error) error = result->cleanup_error;
    if (error) { result->error = error; return pd_error(error); }
    return 0;
}

/* Private bounded descriptor-byte persistence for the future supervisor.
 * This stores bytes, NOT an authenticated descriptor or a launch capability.
 * The controller must construct/validate the complete canonical descriptor,
 * bind its digest to admission, and authenticate held native identities before
 * using it. No deserialization, existing-file adoption, GO or CLI is provided.
 * Use a separate protected directory, never the six-record admission directory.
 * The borrowed directory FD must remain open; all FD/state operations must be
 * serialized in the original process. Retain its exclusive lock and the file
 * inode through later pre-GO checks. Neither flock nor these comparisons exclude
 * a hostile writer with supervisor credentials; protected ownership is required.
 * Failed creation leaves every partial byte in place and cannot be retried from
 * this object or adopted by a fresh create. A complete file after an interrupted
 * operation proves neither fsync success nor authority to continue after restart.
 * Consuming a handle on close failure is not evidence of resource release.
 */
/* PDESC001 bounded data decoder. Views borrow immutable caller-owned bytes;
 * they must not survive mutation/release of that storage. Output is committed
 * only after the entire record is checked. DECODED is not INTENT_MATCHED:
 * authenticated expected evidence, native policy and ownership are separate.
 * No filesystem, allocation, process, reservation or publication side effects.
 */
struct pd_slice { const unsigned char *p; size_t n; };
struct pd_intent {
    struct pd_slice fields[24], executable, argv[128], names[64], values[64], cwd, policy;
    unsigned argc, envc;
    uint64_t limits[5];
};
struct pd_cursor { const unsigned char *p; size_t n; };
static inline int pd_take(struct pd_cursor *c, size_t n, struct pd_slice *s)
{
    if (n > c->n) return pd_error(EINVAL);
    s->p = c->p; s->n = n; c->p += n; c->n -= n; return 0;
}
static inline uint32_t pd_be32(const unsigned char *p)
{
    return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];
}
static inline unsigned pd_be16(const unsigned char *p) { return ((unsigned)p[0]<<8)|p[1]; }
static inline int pd_length_value(struct pd_cursor *c, struct pd_slice *s)
{
    struct pd_slice length;
    if (pd_take(c, 4, &length) < 0) return -1;
    return pd_take(c, pd_be32(length.p), s);
}
static inline int pd_text(struct pd_slice s, int empty, int identity)
{
    if ((!empty && !s.n) || s.n > (identity ? 256U : 1024U)) return pd_error(EINVAL);
    for (size_t i=0;i<s.n;) {
        unsigned a=s.p[i++];
        if (a<32 || a==127) return pd_error(EINVAL);
        if (identity) {
            if (!((a>='A'&&a<='Z')||(a>='a'&&a<='z')||(a>='0'&&a<='9')||
                  a=='.'||a=='_'||a==':'||a=='/'||a=='-')) return pd_error(EINVAL);
        } else if (a>=128) {
            size_t count; unsigned low=128,high=191;
            if (a>=194&&a<=223) count=1;
            else if (a>=224&&a<=239) {count=2;if(a==224)low=160;if(a==237)high=159;}
            else if (a>=240&&a<=244) {count=3;if(a==240)low=144;if(a==244)high=143;}
            else return pd_error(EINVAL);
            if (count>s.n-i || s.p[i]<low || s.p[i]>high) return pd_error(EINVAL);
            for (size_t j=1;j<count;j++) if(s.p[i+j]<128||s.p[i+j]>191) return pd_error(EINVAL);
            i+=count;
        }
    }
    return 0;
}
static inline int pd_env_name(struct pd_slice name)
{
    if (pd_text(name,0,0)<0) return -1;
    for(size_t i=0;i<name.n;i++) {
        unsigned c=name.p[i];
        if (!((c>='A'&&c<='Z')||c=='_'||(i&&c>='0'&&c<='9'))) return pd_error(EINVAL);
    }
    if ((name.n==4&&!memcmp(name.p,"PATH",4))||
        (name.n>=3&&!memcmp(name.p,"LD_",3))||
        (name.n>=5&&!memcmp(name.p,"DYLD_",5))) return pd_error(EPERM);
    return 0;
}
static inline int pd_slice_order(struct pd_slice a, struct pd_slice b)
{
    size_t n=a.n<b.n?a.n:b.n; int r=memcmp(a.p,b.p,n);
    return r ? r : a.n==b.n ? 0 : a.n<b.n ? -1 : 1;
}
static inline int pd_command_decode(struct pd_slice s, struct pd_intent *d)
{
    struct pd_cursor c={s.p,s.n}; struct pd_slice a,e,count;
    if(pd_take(&c,32,&d->executable)<0||pd_length_value(&c,&a)<0||
       pd_length_value(&c,&e)<0||pd_length_value(&c,&d->cwd)<0||c.n) return pd_error(EINVAL);
    struct pd_cursor args={a.p,a.n},env={e.p,e.n};
    if(pd_take(&args,2,&count)<0) return -1;
    d->argc=pd_be16(count.p);if(!d->argc||d->argc>128) return pd_error(EINVAL);
    for(unsigned i=0;i<d->argc;i++)
        if(pd_length_value(&args,&d->argv[i])<0||pd_text(d->argv[i],0,0)<0) return -1;
    if(args.n||pd_take(&env,2,&count)<0) return pd_error(EINVAL);
    d->envc=pd_be16(count.p);if(d->envc>64) return pd_error(EINVAL);
    for(unsigned i=0;i<d->envc;i++) {
        struct pd_slice pair;if(pd_length_value(&env,&pair)<0)return -1;
        struct pd_cursor item={pair.p,pair.n};
        if(pd_length_value(&item,&d->names[i])<0||pd_length_value(&item,&d->values[i])<0||item.n||
           pd_env_name(d->names[i])<0||pd_text(d->values[i],1,0)<0) return pd_error(EINVAL);
        if(i&&pd_slice_order(d->names[i-1],d->names[i])>=0)return pd_error(EINVAL);
    }
    if(env.n||pd_text(d->cwd,0,0)<0||d->cwd.p[0]!='/')return pd_error(EINVAL);
    for(size_t start=1;start<d->cwd.n;) {
        size_t end=start;while(end<d->cwd.n&&d->cwd.p[end]!='/')end++;
        size_t n=end-start;
        if(!n||(n==1&&d->cwd.p[start]=='.')||(n==2&&!memcmp(d->cwd.p+start,"..",2))||
           (end<d->cwd.n&&end+1==d->cwd.n)) return pd_error(EINVAL);
        start=end+1;
    }
    return 0;
}
static inline int __attribute__((unused)) pd_intent_decode(const unsigned char *bytes,
        size_t length, struct pd_intent *out)
{
    if(!bytes||!out||length<16||length>65536||memcmp(bytes,"PDESC001",8)||
       pd_be32(bytes+8)!=length||pd_be16(bytes+12)!=24||pd_be16(bytes+14))return pd_error(EINVAL);
    struct pd_intent d={0};struct pd_cursor c={bytes+16,length-16};
    for(unsigned i=0;i<24;i++) {
        struct pd_slice tag;if(pd_take(&c,2,&tag)<0||pd_be16(tag.p)!=i+1||
            pd_length_value(&c,&d.fields[i])<0)return pd_error(EINVAL);
        struct pd_slice f=d.fields[i];
        if(i==0||i==2||i==5||i==12) {if(pd_text(f,0,1)<0)return -1;}
        else if(i==14) {if(pd_command_decode(f,&d)<0)return -1;}
        else if(i==20) {
            if(f.n!=72)return pd_error(EINVAL);
            d.policy=(struct pd_slice){f.p,32};
            for(unsigned j=0;j<5;j++) {
                uint64_t v=0;for(unsigned k=0;k<8;k++)v=(v<<8)|f.p[32+j*8+k];
                if(!v)return pd_error(EINVAL);
                d.limits[j]=v;
            }
        } else if(f.n!=32)return pd_error(EINVAL);
    }
    if(c.n)return pd_error(EINVAL);
    *out=d;return 0;
}

/* Both records are bounded decoded data. The independently acquired expected
 * record comes from the authenticated parent, never from the candidate. This
 * comparison grants no owner, session authentication, reservation or GO. */
static inline int pd_intent_compare(const struct pd_intent *expected,
                                    const struct pd_intent *candidate)
{
    for(unsigned i=0;i<24;i++)
        if(i!=14 && i!=20 && pd_slice_order(expected->fields[i],candidate->fields[i]))
            return pd_error(EPERM);
    if(pd_slice_order(expected->executable,candidate->executable)||
       pd_slice_order(expected->cwd,candidate->cwd)||expected->argc!=candidate->argc||
       expected->envc!=candidate->envc||pd_slice_order(expected->policy,candidate->policy))
        return pd_error(EPERM);
    for(unsigned i=0;i<expected->argc;i++)
        if(pd_slice_order(expected->argv[i],candidate->argv[i]))return pd_error(EPERM);
    for(unsigned i=0;i<expected->envc;i++)
        if(pd_slice_order(expected->names[i],candidate->names[i])||
           pd_slice_order(expected->values[i],candidate->values[i]))return pd_error(EPERM);
    for(unsigned i=0;i<5;i++)if(expected->limits[i]!=candidate->limits[i])return pd_error(EPERM);
    return 0;
}
static inline int pd_intent_fd_read(int fd,unsigned char bytes[65536],struct stat *identity)
{
    struct stat after;
    int flags=fcntl(fd,F_GETFL,0);
    if(flags<0||fstat(fd,identity)<0)return -1;
    if((flags&O_ACCMODE)!=O_RDONLY||!S_ISREG(identity->st_mode)||identity->st_nlink!=1||
       identity->st_size<16||identity->st_size>65536)return pd_error(EINVAL);
    size_t n=0,length=(size_t)identity->st_size;
    while(n<length){ssize_t r=pread(fd,bytes+n,length-n,(off_t)n);if(r<0&&errno==EINTR)continue;if(r<=0)return pd_error(EIO);n+=(size_t)r;}
    if(fstat(fd,&after)<0)return -1;
    if(after.st_dev!=identity->st_dev||after.st_ino!=identity->st_ino||
       after.st_size!=identity->st_size||after.st_mode!=identity->st_mode||
       after.st_uid!=identity->st_uid||after.st_gid!=identity->st_gid||after.st_nlink!=1)
        return pd_error(ESTALE);
    return 0;
}
static inline int __attribute__((unused)) pd_intent_compare_fds(int expected_fd,int candidate_fd)
{
    unsigned char expected_bytes[65536],candidate_bytes[65536],again[65536];
    struct stat expected_identity,candidate_identity,after;
    struct pd_intent expected,candidate;
    /* Acquire/decode expected before even reading the candidate. */
    if(pd_intent_fd_read(expected_fd,expected_bytes,&expected_identity)<0||
       pd_intent_decode(expected_bytes,(size_t)expected_identity.st_size,&expected)<0||
       pd_intent_fd_read(candidate_fd,candidate_bytes,&candidate_identity)<0)return -1;
    if(expected_identity.st_dev==candidate_identity.st_dev&&expected_identity.st_ino==candidate_identity.st_ino)
        return pd_error(EINVAL);
    if(pd_intent_decode(candidate_bytes,(size_t)candidate_identity.st_size,&candidate)<0||
       pd_intent_compare(&expected,&candidate)<0)return -1;
    if(pd_intent_fd_read(expected_fd,again,&after)<0)return -1;
    if(after.st_dev!=expected_identity.st_dev||after.st_ino!=expected_identity.st_ino||
       after.st_size!=expected_identity.st_size||after.st_mode!=expected_identity.st_mode||
       after.st_uid!=expected_identity.st_uid||after.st_gid!=expected_identity.st_gid||
       memcmp(again,expected_bytes,(size_t)after.st_size))return pd_error(ESTALE);
    if(pd_intent_fd_read(candidate_fd,again,&after)<0)return -1;
    if(after.st_dev!=candidate_identity.st_dev||after.st_ino!=candidate_identity.st_ino||
       after.st_size!=candidate_identity.st_size||after.st_mode!=candidate_identity.st_mode||
       after.st_uid!=candidate_identity.st_uid||after.st_gid!=candidate_identity.st_gid||
       memcmp(again,candidate_bytes,(size_t)after.st_size))return pd_error(ESTALE);
    return 0;
}

#define PD_DESCRIPTOR_MAX 65536
struct pd_descriptor_pin {
    enum { PD_DESCRIPTOR_NEW, PD_DESCRIPTOR_HELD, PD_DESCRIPTOR_FAILED,
           PD_DESCRIPTOR_RELEASED } state;
    pid_t owner;
    int dir, fd, error, close_error, unlock_error;
    struct stat directory, identity;
    size_t length;
    unsigned char bytes[PD_DESCRIPTOR_MAX];
};
#define PD_DESCRIPTOR_INITIALIZER {.dir = -1, .fd = -1}
static inline int pd_descriptor_identity(const struct pd_descriptor_pin *pin)
{
    struct stat directory, held, path;
    if (pd_directory(pin->dir) < 0 || fstat(pin->dir, &directory) < 0 ||
        fstat(pin->fd, &held) < 0 ||
        fstatat(pin->dir, "descriptor", &path, AT_SYMLINK_NOFOLLOW) < 0) return -1;
    if (directory.st_dev != pin->directory.st_dev || directory.st_ino != pin->directory.st_ino ||
        !S_ISREG(held.st_mode) || held.st_uid != geteuid() ||
        (held.st_mode & 07777) != 0600 || held.st_nlink != 1 ||
        held.st_size != (off_t)pin->length ||
        held.st_dev != pin->identity.st_dev || held.st_ino != pin->identity.st_ino ||
        held.st_gid != pin->identity.st_gid ||
        path.st_dev != held.st_dev || path.st_ino != held.st_ino ||
        path.st_mode != held.st_mode || path.st_uid != held.st_uid ||
        path.st_gid != held.st_gid || path.st_nlink != 1 || path.st_size != held.st_size)
        return pd_error(ESTALE);
    int flags = fcntl(pin->fd, F_GETFD, 0);
    if (flags < 0) return -1;
    return flags & FD_CLOEXEC ? 0 : pd_error(EPERM);
}
static inline int __attribute__((unused)) pd_descriptor_check(const struct pd_descriptor_pin *pin)
{
    if (!pin) return pd_error(EINVAL);
    if (pin->owner != getpid()) return pd_error(EPERM);
    if (pin->state != PD_DESCRIPTOR_HELD || !pin->length || pin->length > PD_DESCRIPTOR_MAX)
        return pd_error(ESTALE);
    if (pd_descriptor_identity(pin) < 0) return -1;
    unsigned char block[4096]; size_t offset = 0;
    while (offset < pin->length) {
        size_t n = pin->length - offset; if (n > sizeof(block)) n = sizeof(block);
        ssize_t got = pread(pin->fd, block, n, (off_t)offset);
        if (got < 0) { if (errno == EINTR) continue; return -1; }
        if (!got) return pd_error(EIO);
        if (memcmp(block, pin->bytes + offset, (size_t)got)) return pd_error(ESTALE);
        offset += (size_t)got;
    }
    return pd_descriptor_identity(pin);
}
static inline void pd_descriptor_cleanup(struct pd_descriptor_pin *pin)
{
    if (pin->fd >= 0) {
        int fd = pin->fd; pin->fd = -1;
        if (close(fd) < 0) pin->close_error = errno;
    }
    if (flock(pin->dir, LOCK_UN) < 0) pin->unlock_error = errno;
}
static inline int __attribute__((unused)) pd_descriptor_create(int dir,
        const void *bytes, size_t length, struct pd_descriptor_pin *pin)
{
    if (!pin || !bytes || !length || length > PD_DESCRIPTOR_MAX ||
        pin->state != PD_DESCRIPTOR_NEW || pin->owner || pin->fd != -1 || pin->dir != -1 ||
        pin->length || pin->error || pin->close_error || pin->unlock_error)
        return pd_error(EINVAL);
    struct stat directory;
    if (pd_directory(dir) < 0 || fstat(dir, &directory) < 0) return -1;
    pin->owner = getpid(); pin->dir = dir; pin->directory = directory;
    pin->length = length; memcpy(pin->bytes, bytes, length);
    pin->state = PD_DESCRIPTOR_FAILED;
    if (flock(dir, LOCK_EX | LOCK_NB) < 0) { pin->error = errno; return -1; }
    pin->fd = openat(dir, "descriptor", O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (pin->fd < 0) pin->error = errno;
    if (!pin->error && fstat(pin->fd, &pin->identity) < 0) pin->error = errno;
    size_t used = 0;
    while (!pin->error && used < length) {
        ssize_t n = write(pin->fd, pin->bytes + used, length - used);
        if (n < 0) { if (errno == EINTR) continue; pin->error = errno; }
        else if (!n) pin->error = EIO;
        else used += (size_t)n;
    }
    if (!pin->error && fsync(pin->fd) < 0) pin->error = errno;
    if (!pin->error && fsync(dir) < 0) pin->error = errno;
    if (!pin->error) {
        pin->state = PD_DESCRIPTOR_HELD;
        if (pd_descriptor_check(pin) < 0) pin->error = errno;
    }
    if (pin->error) {
        pin->state = PD_DESCRIPTOR_FAILED; pd_descriptor_cleanup(pin);
        return pd_error(pin->error);
    }
    return 0;
}
static inline int __attribute__((unused)) pd_descriptor_release(struct pd_descriptor_pin *pin)
{
    if (!pin) return pd_error(EINVAL);
    if (pin->owner != getpid()) return pd_error(EPERM);
    if (pin->state != PD_DESCRIPTOR_HELD) return pd_error(ESTALE);
    pin->state = PD_DESCRIPTOR_RELEASED; pd_descriptor_cleanup(pin);
    int error = pin->close_error ? pin->close_error : pin->unlock_error;
    return error ? pd_error(error) : 0;
}

/* Private SHA-256 binding of the held descriptor bytes to a new reservation.
 * This binds bytes only, not their meaning or the supervisor's authority.
 * Keep the descriptor lock/FD through subsequent authenticated pre-GO checks.
 * Admission uses a distinct protected directory. The trusted setup child must
 * close inherited descriptor FDs through its inventory, never unlock the
 * parent's shared open description. No existing descriptor/admission is adopted.
 * All operations remain serialized by the future protected supervisor.
 */
#include <stdint.h>
static inline uint32_t pd_sha_rotr(uint32_t x, unsigned n)
{
    return (x >> n) | (x << (32 - n));
}
static inline void pd_descriptor_sha256(const unsigned char *bytes, size_t length,
                                       char out[65])
{
    static const uint32_t k[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    };
    uint32_t h[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
                     0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    /* Only called after the descriptor's 1..65536 length has been checked. */
    size_t total = ((length + 9 + 63) / 64) * 64;
    uint64_t bits = (uint64_t)length * 8;
    for (size_t offset = 0; offset < total; offset += 64) {
        uint32_t w[64] = {0};
        for (size_t j = 0; j < 64; ++j) {
            size_t at = offset + j;
            unsigned char b = at < length ? bytes[at] : at == length ? 0x80 :
                at >= total - 8 ? (unsigned char)(bits >> ((total - 1 - at) * 8)) : 0;
            w[j / 4] |= (uint32_t)b << (24 - (j % 4) * 8);
        }
        for (size_t j = 16; j < 64; ++j) {
            uint32_t x = w[j-15], y = w[j-2];
            w[j] = w[j-16] + (pd_sha_rotr(x,7)^pd_sha_rotr(x,18)^(x>>3)) +
                w[j-7] + (pd_sha_rotr(y,17)^pd_sha_rotr(y,19)^(y>>10));
        }
        uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],v=h[7];
        for (size_t j = 0; j < 64; ++j) {
            uint32_t t1 = v + (pd_sha_rotr(e,6)^pd_sha_rotr(e,11)^pd_sha_rotr(e,25)) +
                ((e&f)^((~e)&g)) + k[j] + w[j];
            uint32_t t2 = (pd_sha_rotr(a,2)^pd_sha_rotr(a,13)^pd_sha_rotr(a,22)) +
                ((a&b)^(a&c)^(b&c));
            v=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
        }
        h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=v;
    }
    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < 32; ++i) {
        unsigned char b = (unsigned char)(h[i/4] >> (24-(i%4)*8));
        out[i*2]=hex[b>>4];out[i*2+1]=hex[b&15];
    }
    out[64]=0;
}
static inline int __attribute__((unused)) pd_descriptor_binding(
        const struct pd_descriptor_pin *pin, char out[65])
{
    if (!out) return pd_error(EINVAL);
    if (pd_descriptor_check(pin) < 0) return -1;
    char binding[65]; pd_descriptor_sha256(pin->bytes, pin->length, binding);
    if (pd_descriptor_check(pin) < 0) return -1;
    memcpy(out, binding, sizeof(binding)); return 0;
}
/* RSP1 is a private challenge/response, never a serialized setup owner.
 * The authenticated JS process retains the channel and all source handles.
 * These portable operations do not authenticate TAKT or enforce native policy.
 * Fixed inherited descriptors are installed only by that private composition;
 * the ordinary helper CLI and legacy owner entry points remain unchanged. */
#define PD_RSP_SIZE 208
static inline int pd_rsp_valid(const unsigned char *b, size_t n)
{
    if (n != PD_RSP_SIZE || memcmp(b,"RSP1",4) || b[4]!=1 ||
        b[5]<1 || b[5]>3 || b[6]<1 || b[6]>5 || b[7]) return pd_error(EPROTO);
    uint64_t sequence=0; for(unsigned i=8;i<16;i++) sequence=(sequence<<8)|b[i];
    return sequence ? 0 : pd_error(EPROTO);
}
static inline int pd_rsp_reply(const unsigned char *challenge,
                               const unsigned char *reply, size_t n)
{
    if(pd_rsp_valid(challenge,PD_RSP_SIZE)<0 || pd_rsp_valid(reply,n)<0)return -1;
    if(challenge[5]!=1 || reply[5]!=2 || memcmp(challenge,reply,5) ||
       memcmp(challenge+6,reply+6,PD_RSP_SIZE-6))return pd_error(EPROTO);
    return 0;
}
static inline void pd_rsp_hash(const unsigned char *bytes,size_t n,unsigned char out[32])
{
    char hex[65];pd_descriptor_sha256(bytes,n,hex);
    for(unsigned i=0;i<32;i++) {
        unsigned a=hex[2*i],b=hex[2*i+1];
        out[i]=(unsigned char)(((a<='9'?a-'0':a-'a'+10)<<4)|(b<='9'?b-'0':b-'a'+10));
    }
}
/* Only the authenticated U harness compiles this finite profile. No runtime
 * argument, environment variable or mutually forged descriptor selects it. */
#ifdef PD_U_HOST_PROTOCOL_V1
static inline int pd_u_remaining(const struct timespec *start,int budget)
{
    struct timespec now;
    if(clock_gettime(CLOCK_MONOTONIC,&now)<0)return -1;
    if(now.tv_sec<start->tv_sec||(now.tv_sec==start->tv_sec&&now.tv_nsec<start->tv_nsec))return pd_error(ESTALE);
    if(now.tv_sec-start->tv_sec>1260)return pd_error(ETIMEDOUT);
    long long elapsed=(long long)(now.tv_sec-start->tv_sec)*1000000000LL+now.tv_nsec-start->tv_nsec;
    long long left=(long long)budget*1000000LL-elapsed;
    if(left<=0)return pd_error(ETIMEDOUT);
    return (int)((left+999999LL)/1000000LL);
}
static inline int pd_u_policy(const struct pd_intent *intent)
{
    static const unsigned char digest[32]={0x13,0xe6,0x05,0x6d,0x76,0xdd,0x25,0x9e,0xa5,0x4f,0xad,0x57,0xe3,0x9e,0x1c,0xd1,0x62,0x9c,0xf7,0x7d,0x64,0xd0,0xd2,0xe5,0x96,0x0a,0x33,0x66,0x7d,0x17,0x86,0x2e};
    static const uint64_t limits[5]={1260000,1000,134217728,1,65536};
    if(intent->policy.n!=32||memcmp(intent->policy.p,digest,32))return pd_error(EPERM);
    for(unsigned i=0;i<5;i++)if(intent->limits[i]!=limits[i])return pd_error(EPERM);
    return 0;
}
/* Same exact GO bytes and confinement, with the parent's original start.
 * This child has no workload FDs and cannot execute a command. */
static inline int pd_u_child_wait(struct pd_setup_owner *owner,const struct timespec *start)
{
    if(owner->setup_process!=getpid()||owner->owner==getpid()||owner->stage!=PD_SETUP_CHILD||owner->begin_error||owner->child!=-1)return pd_error(EPERM);
    struct pd_fd_entry receiver=owner->pipe.receiver,sender=owner->pipe.sender;
    owner->stage=PD_SETUP_WAIT_FAILED;owner->pipe.receiver.fd=-1;owner->pipe.sender.fd=-1;owner->store=-1;
    if(pd_u_remaining(start,1260000)<0||pd_binding_valid(owner->binding)<0||pd_go_channel_valid(&receiver)<0||sender.role!=PD_PIPE_WRITE||sender.fd==receiver.fd||pd_fd_matches(&sender)<0)return -1;
    if(pd_fd_filter(&receiver,1,receiver.fd)<0)return -1;
    char expected[PD_GO_SIZE],received[PD_GO_SIZE+1];size_t used=0;
    memcpy(expected,"PDGO1\n",6);memcpy(expected+6,owner->binding,64);expected[70]='\n';
    for(;;){
        int remaining=pd_u_remaining(start,1260000);if(remaining<0||pd_go_channel_valid(&receiver)<0)return -1;
        struct pollfd p={.fd=receiver.fd,.events=POLLIN};int ready=poll(&p,1,remaining);
        if(ready<0){if(errno==EINTR)continue;return -1;}
        if(pd_u_remaining(start,1260000)<0||pd_go_channel_valid(&receiver)<0)return -1;
        if(!ready)continue;
        if((p.revents&~(POLLIN|POLLHUP))||!(p.revents&(POLLIN|POLLHUP)))return pd_error(EIO);
        ssize_t n=read(receiver.fd,received+used,sizeof(received)-used);
        if(n<0){if(errno==EINTR||errno==EAGAIN)continue;return -1;}
        if(pd_u_remaining(start,1260000)<0||pd_go_channel_valid(&receiver)<0)return -1;
        if(!n){
            if(used!=PD_GO_SIZE)return pd_error(EPROTO);
            if(close(receiver.fd)<0)return -1;
            int fds[PD_FD_SCAN_MAX];size_t found=0;
            if(pd_fd_snapshot(fds,&found)<0)return -1;
            if(found)return pd_error(ESTALE);
            if(pd_u_remaining(start,1260000)<0)return -1;
            owner->stage=PD_SETUP_WAITED;return 0;
        }
        used+=(size_t)n;if(used>PD_GO_SIZE||memcmp(received,expected,used))return pd_error(EPROTO);
    }
}
#endif
struct pd_semantic_reservation {
    pid_t process;
    int expected_fd,candidate_fd,descriptor_dir,admission_dir,channel;
    struct stat expected_identity,candidate_identity,descriptor_identity,admission_identity;
    unsigned char expected[65536],candidate[65536],fingerprint[32];
    struct pd_intent intent;
    struct pd_descriptor_pin pin;
    struct pd_setup_owner setup;
    struct pd_checkpoint reservation;
    struct timespec start;
#ifdef PD_U_HOST_PROTOCOL_V1
    struct timespec challenge_start;
    int challenge_active;
#endif
    uint64_t sequence;
    int primary_error,checkpoint_error,unlock_error,cancel_error,pin_close_error;
    int publication_attempted,closure_error,sender_error,observation_error,status_valid,status;
    enum pd_go_delivery delivery;
};
static inline int pd_semantic_remaining(struct pd_semantic_reservation *s)
{
#ifdef PD_U_HOST_PROTOCOL_V1
    int global=pd_u_remaining(&s->start,1260000);if(global<0)return -1;
    if(!s->challenge_active)return global;
    int stage=pd_u_remaining(&s->challenge_start,240000);if(stage<0)return -1;
    return global<stage?global:stage;
#else
    return pd_go_remaining(&s->start,10000);
#endif
}
static inline int pd_rsp_wait(struct pd_semantic_reservation *s,short events)
{
    for(;;){
        int remaining=pd_semantic_remaining(s);if(remaining<0)return -1;
        struct pollfd p={.fd=s->channel,.events=events};int n=poll(&p,1,remaining);
        if(n<0&&errno==EINTR)continue;
#ifdef PD_U_HOST_PROTOCOL_V1
        if(pd_semantic_remaining(s)<0)return -1;
#endif
        if(!n)return pd_error(ETIMEDOUT);
        if(n<0)return -1;
        return (p.revents&events)?0:pd_error(EPIPE);
    }
}
static inline int pd_semantic_recheck(struct pd_semantic_reservation *s)
{
    if(s->process!=getpid())return pd_error(EPERM);
    if(pd_semantic_remaining(s)<0)return -1;
    unsigned char again[65536];struct stat st;
    const int fds[2]={s->expected_fd,s->candidate_fd};
    const struct stat *ids[2]={&s->expected_identity,&s->candidate_identity};
    const unsigned char *raw[2]={s->expected,s->candidate};
    for(unsigned i=0;i<2;i++) {
        if(pd_intent_fd_read(fds[i],again,&st)<0)return -1;
        const struct stat *old=ids[i];
        if(st.st_dev!=old->st_dev||st.st_ino!=old->st_ino||st.st_size!=old->st_size||
           st.st_mode!=old->st_mode||st.st_uid!=old->st_uid||st.st_gid!=old->st_gid||
           memcmp(again,raw[i],(size_t)st.st_size))return pd_error(ESTALE);
    }
    const int dirs[2]={s->descriptor_dir,s->admission_dir};
    const struct stat *di[2]={&s->descriptor_identity,&s->admission_identity};
    for(unsigned i=0;i<2;i++) {
        if(pd_directory(dirs[i])<0||fstat(dirs[i],&st)<0)return -1;
        if(st.st_dev!=di[i]->st_dev||st.st_ino!=di[i]->st_ino)return pd_error(ESTALE);
    }
    if(s->pin.state==PD_DESCRIPTOR_HELD&&pd_descriptor_check(&s->pin)<0)return -1;
    return pd_semantic_remaining(s)<0?-1:0;
}
static inline int pd_semantic_challenge(struct pd_semantic_reservation *s,unsigned stage)
{
#ifdef PD_U_HOST_PROTOCOL_V1
    if(pd_semantic_remaining(s)<0||clock_gettime(CLOCK_MONOTONIC,&s->challenge_start)<0)return -1;
    s->challenge_active=1;
#endif
    unsigned char frame[PD_RSP_SIZE]={0},reply[4096];
    /* Reject prequeued/future replies before issuing this fresh challenge. */
    struct pollfd pending={.fd=s->channel,.events=POLLIN};
    if(poll(&pending,1,0)!=0)return pd_error(EPROTO);
    memcpy(frame,"RSP1",4);frame[4]=1;frame[5]=1;frame[6]=(unsigned char)stage;
    uint64_t seq=++s->sequence;for(unsigned i=0;i<8;i++)frame[15-i]=(unsigned char)(seq>>(8*i));
    int random=open("/dev/urandom",O_RDONLY|O_CLOEXEC);if(random<0)return -1;
    size_t used=0;int error=0;
    while(used<32){ssize_t n=read(random,frame+16+used,32-used);if(n<0&&errno==EINTR)continue;if(n<=0){error=EIO;break;}used+=(size_t)n;}
    if(close(random)<0&&!error)error=errno;if(error)return pd_error(error);
    pd_rsp_hash(s->intent.fields[12].p,s->intent.fields[12].n,frame+48);
    memcpy(frame+80,s->intent.fields[13].p,32);
    pd_rsp_hash(s->candidate,(size_t)s->candidate_identity.st_size,frame+112);
    pd_rsp_hash(s->expected,(size_t)s->expected_identity.st_size,frame+144);
    memcpy(frame+176,s->fingerprint,32);
    used=0;
    while(used<sizeof(frame)){if(pd_rsp_wait(s,POLLOUT)<0)return -1;ssize_t n=write(s->channel,frame+used,sizeof(frame)-used);if(n<0&&errno==EINTR)continue;if(n<=0)return pd_error(EPIPE);used+=(size_t)n;}
    used=0;
    while(used<PD_RSP_SIZE){if(pd_rsp_wait(s,POLLIN)<0)return -1;ssize_t n=read(s->channel,reply+used,sizeof(reply)-used);if(n<0&&errno==EINTR)continue;if(n<=0)return pd_error(EPIPE);used+=(size_t)n;if(used>PD_RSP_SIZE)return pd_error(EPROTO);}
    if(pd_semantic_remaining(s)<0||pd_rsp_reply(frame,reply,used)<0)return -1;
    pending.revents=0;if(poll(&pending,1,0)!=0)return pd_error(EPROTO);
    return pd_semantic_recheck(s);
}
/* This private composition retains the same owner across all five challenges.
 * Stage3's grant is withheld by JS until its private publication operation.
 * No child exists before that grant. Publication is consumed before ADMITTED;
 * subsequent failures retain admission and never route through cancellation. */
static inline int pd_semantic_admitted(struct pd_semantic_reservation *s,
                                      const struct pd_checkpoint *checkpoint)
{
    int phase=-1;
    if(pd_semantic_recheck(s)<0||pd_checkpoint_check(s->admission_dir,checkpoint)<0||
       pd_scan(s->admission_dir,s->setup.binding,&phase)<0)return -1;
    if(pd_semantic_remaining(s)<0)return -1;
    return phase==PD_ADMITTED?0:pd_error(ESTALE);
}
static inline void pd_semantic_publication(struct pd_semantic_reservation *s)
{
    if(pd_semantic_remaining(s)<0||flock(s->admission_dir,LOCK_EX|LOCK_NB)<0){s->primary_error=errno;return;}
    /* Transfer, never recapture, the original reservation pins. */
    struct pd_checkpoint checkpoint=s->reservation;pd_checkpoint_init(&s->reservation);
    int phase=-1;
    if(pd_checkpoint_check(s->admission_dir,&checkpoint)<0||
       pd_semantic_challenge(s,3)<0||
       pd_checkpoint_check(s->admission_dir,&checkpoint)<0||
       pd_scan(s->admission_dir,s->setup.binding,&phase)<0)s->primary_error=errno;
    if(!s->primary_error&&phase!=PD_PREPARED)s->primary_error=ESTALE;
    if(!s->primary_error&&!s->checkpoint_error){
        int forked=pd_setup_fork(&s->setup.pipe,&s->setup.child);
        if(!forked){
            s->setup.stage=PD_SETUP_CHILD;s->setup.setup_process=getpid();
#ifdef PD_U_HOST_PROTOCOL_V1
            int ok=pd_u_child_wait(&s->setup,&s->start)==0;
#else
            struct pd_setup_wait_result waited;
            int remaining=pd_semantic_remaining(s);
            int ok=remaining>0&&pd_setup_owner_wait(&s->setup,NULL,0,remaining,&waited)==0;
#endif
            /* Only this actual receive path can return zero. No workload exec. */
            _exit(ok?0:71);
        }
        if(s->setup.child>0)s->setup.stage=PD_SETUP_PARENT;
        if(forked<0){s->setup.begin_error=errno;s->primary_error=errno;}
    }
    if(!s->primary_error&&!s->checkpoint_error){
        s->publication_attempted=1;s->setup.stage=PD_SETUP_PUBLISH_FAILED;
        if(pd_semantic_recheck(s)<0||
           pd_admission_transition_pinned(s->admission_dir,s->setup.binding,
                                         PD_PREPARED,PD_ADMITTED,&checkpoint)<0)s->primary_error=errno;
        if(!s->primary_error&&(pd_semantic_challenge(s,4)<0||pd_semantic_admitted(s,&checkpoint)<0))s->primary_error=errno;
        if(!s->primary_error&&(pd_semantic_challenge(s,5)<0||pd_semantic_admitted(s,&checkpoint)<0))s->primary_error=errno;
        if(!s->primary_error&&pd_go_publish(&s->setup.pipe.sender,s->setup.binding,&s->delivery)<0)s->primary_error=errno;
        if(!s->primary_error)s->setup.stage=PD_SETUP_PUBLISHED;
    }
    if(pd_checkpoint_close(&checkpoint)<0&&!s->checkpoint_error)s->checkpoint_error=errno;
    if(flock(s->admission_dir,LOCK_UN)<0)s->unlock_error=errno;
    if(s->publication_attempted&&!s->unlock_error){
        struct pd_setup_closure closure;
        if(pd_setup_owner_close_admission(&s->setup,&closure)<0)s->closure_error=errno;
        if(!s->closure_error&&s->setup.pipe.sender.fd>=0){
            struct pd_sender_release_result released;
            if(pd_setup_owner_release_sender(&s->setup,&released)<0)s->sender_error=errno;
        }
        if(s->setup.child>0){
            struct pd_setup_observation observed;
            if(pd_setup_owner_reap(&s->setup,1000,&observed)<0)s->observation_error=errno;
            s->status_valid=observed.status_valid;s->status=observed.status;
            if(!s->primary_error&&s->status_valid&&(!WIFEXITED(s->status)||WEXITSTATUS(s->status)))s->primary_error=ECHILD;
        }
    }
}
static inline int __attribute__((unused)) pd_semantic_reserve_bridge(void)
{
    struct pd_semantic_reservation s={.process=getpid(),.expected_fd=3,.candidate_fd=4,
        .descriptor_dir=5,.admission_dir=6,.channel=8,
        .pin=PD_DESCRIPTOR_INITIALIZER,.setup=PD_SETUP_OWNER_INITIALIZER};
    struct pd_intent candidate;struct stat fp;
    pd_checkpoint_init(&s.reservation);
    if(clock_gettime(CLOCK_MONOTONIC,&s.start)<0||
       pd_intent_fd_read(3,s.expected,&s.expected_identity)<0||
       pd_intent_decode(s.expected,(size_t)s.expected_identity.st_size,&s.intent)<0||
       pd_intent_fd_read(4,s.candidate,&s.candidate_identity)<0||
       pd_intent_decode(s.candidate,(size_t)s.candidate_identity.st_size,&candidate)<0||
       pd_intent_compare(&s.intent,&candidate)<0||pd_directory(5)<0||pd_directory(6)<0||
       fstat(5,&s.descriptor_identity)<0||fstat(6,&s.admission_identity)<0||fstat(7,&fp)<0)
        return -1;
    if((s.expected_identity.st_dev==s.candidate_identity.st_dev&&s.expected_identity.st_ino==s.candidate_identity.st_ino)||
       (s.descriptor_identity.st_dev==s.admission_identity.st_dev&&s.descriptor_identity.st_ino==s.admission_identity.st_ino)||
       !S_ISREG(fp.st_mode)||fp.st_size!=32||(fcntl(7,F_GETFL,0)&O_ACCMODE)!=O_RDONLY||
       pread(7,s.fingerprint,32,0)!=32)return pd_error(EINVAL);
#ifdef PD_U_HOST_PROTOCOL_V1
    if(pd_u_policy(&s.intent)<0||pd_u_policy(&candidate)<0)return -1;
#endif
    if(pd_semantic_challenge(&s,1)<0)return -1;
    if(flock(6,LOCK_EX|LOCK_NB)<0)return -1;
    struct pd_checkpoint checkpoint;pd_checkpoint_init(&checkpoint);
    if(pd_semantic_challenge(&s,2)<0)s.primary_error=errno;
    if(!s.primary_error&&pd_descriptor_create(5,s.candidate,(size_t)s.candidate_identity.st_size,&s.pin)<0)s.primary_error=errno;
    if(!s.primary_error&&pd_descriptor_binding(&s.pin,s.setup.binding)<0)s.primary_error=errno;
    if(!s.primary_error&&pd_control_pipe_open(&s.setup.pipe)<0)s.primary_error=errno;
    if(!s.primary_error){
        s.setup.owner=getpid();s.setup.store=6;s.setup.store_identity=s.admission_identity;s.setup.stage=PD_SETUP_UNRESOLVED;
        if(pd_semantic_recheck(&s)<0||pd_admission_transition_locked(6,s.setup.binding,PD_EMPTY,PD_PREPARED,&checkpoint)<0)s.primary_error=errno;
        else if(pd_semantic_remaining(&s)<0)s.primary_error=errno;
        else s.setup.stage=PD_SETUP_RESERVED;
    }
    if(!s.primary_error){s.reservation=checkpoint;pd_checkpoint_init(&checkpoint);}
    if(pd_checkpoint_close(&checkpoint)<0)s.checkpoint_error=errno;
    if(flock(6,LOCK_UN)<0)s.unlock_error=errno;
    if(!s.primary_error&&!s.checkpoint_error&&!s.unlock_error){
        puts("R_RESERVED");fflush(stdout);
        pd_semantic_publication(&s);
    }
    if(s.setup.stage==PD_SETUP_RESERVED||s.setup.stage==PD_SETUP_PARENT){struct pd_setup_cleanup cleanup;
        if(pd_setup_owner_cancel(&s.setup,1000,&cleanup)<0)s.cancel_error=errno;}
    if(pd_checkpoint_close(&s.reservation)<0&&!s.checkpoint_error)s.checkpoint_error=errno;
    if(s.pin.state==PD_DESCRIPTOR_HELD&&pd_descriptor_release(&s.pin)<0)s.pin_close_error=errno;
    fprintf(stderr,"R_RESERVATION_END primary=%d checkpoint=%d unlock=%d cancel=%d pinClose=%d stage=%d\n",
        s.primary_error,s.checkpoint_error,s.unlock_error,s.cancel_error,s.pin_close_error,s.setup.stage);
    fprintf(stderr,"R_PUBLICATION_END attempted=%d delivery=%d closure=%d sender=%d observation=%d statusValid=%d status=%d\n",
        s.publication_attempted,s.delivery,s.closure_error,s.sender_error,s.observation_error,s.status_valid,s.status);
    int error=s.primary_error?s.primary_error:s.checkpoint_error?s.checkpoint_error:s.unlock_error?s.unlock_error:s.cancel_error?s.cancel_error:s.pin_close_error?s.pin_close_error:s.closure_error?s.closure_error:s.sender_error?s.sender_error:s.observation_error;
    if(!error&&s.publication_attempted&&s.status_valid&&s.delivery==PD_GO_COMPLETE){puts("R_PUBLISHED");fflush(stdout);}
    return error?pd_error(error):0;
}
static inline int __attribute__((unused)) pd_setup_owner_begin_descriptor(int dir,
        const struct pd_descriptor_pin *descriptor, struct pd_setup_owner *owner)
{
#ifndef PD_LEGACY_OWNER_TEST
    (void)dir; (void)descriptor; (void)owner;
    return pd_error(EPERM);
#else
    /* New semantic format must never enter the historical opaque path.
     * Native/semantic integration is absent; no reservation or fork is allowed. */
    if (descriptor && descriptor->length >= 5 && !memcmp(descriptor->bytes, "PDESC", 5))
        return pd_error(EPERM);
    char binding[65]; struct stat admission;
    if (!owner || !descriptor) return pd_error(EINVAL);
    if (pd_descriptor_binding(descriptor, binding) < 0 ||
        pd_directory(dir) < 0 || fstat(dir, &admission) < 0) return -1;
    if (admission.st_dev == descriptor->directory.st_dev &&
        admission.st_ino == descriptor->directory.st_ino) return pd_error(EINVAL);
    return pd_setup_owner_begin(dir, binding, owner);
#endif
}

/* Private descriptor-byte binding at the one-shot publication boundary.
 * The protected supervisor must authenticate descriptor meaning, helper and
 * native policy first and exclude concurrent writes/FD operations throughout.
 * Matching a digest is not that authentication: this composes held bytes with
 * admission only. No public CLI or restart adoption reaches this operation.
 * Recheck before any admission write and after ADMITTED is durable, then check
 * the pinned admission history before GO. A rejected post-storage check leaves
 * ADMITTED in place and the sender owned; never retry, roll back or infer exec.
 * Preserve cleanup failure separately from the first error. COMPLETE followed
 * by cleanup failure remains delivery COMPLETE, not successful publication.
 * The original owner may close admission, release a retained sender and observe
 * its direct child separately; none of those operations proves domain empty.
 */
struct pd_descriptor_publication {
    int attempted, error, cleanup_error;
    enum pd_go_delivery delivery;
};
static inline int __attribute__((unused)) pd_descriptor_matches_binding(const struct pd_descriptor_pin *descriptor,
                                                 const char *binding)
{
    char actual[65];
    if (pd_descriptor_binding(descriptor, actual) < 0) return -1;
    return strcmp(actual, binding) ? pd_error(ESTALE) : 0;
}
static inline int __attribute__((unused)) pd_setup_owner_publish_descriptor(
        struct pd_setup_owner *owner, const struct pd_descriptor_pin *descriptor,
        struct pd_descriptor_publication *result)
{
#ifndef PD_LEGACY_OWNER_TEST
    (void)owner; (void)descriptor;
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_descriptor_publication){0};
    return pd_error(EPERM);
#else
    if (!result) return pd_error(EINVAL);
    *result = (struct pd_descriptor_publication){0};
    if (descriptor && descriptor->length >= 5 && !memcmp(descriptor->bytes, "PDESC", 5))
        return pd_error(EPERM);
    if (!owner || !descriptor) return pd_error(EINVAL);
    if (owner->owner != getpid()) return pd_error(EPERM);
    if (owner->stage != PD_SETUP_PARENT || owner->closure != PD_SETUP_CLOSE_NEW ||
        owner->sender_release_attempted) return pd_error(ESTALE);
    if (owner->begin_error || owner->child <= 0 || owner->child == getpid() ||
        owner->pipe.receiver.fd != -1) return pd_error(EPERM);
    struct stat identity;
    if (pd_binding_valid(owner->binding) < 0 || pd_directory(owner->store) < 0 ||
        fstat(owner->store, &identity) < 0 ||
        pd_pending_sender_valid(&owner->pipe.sender) < 0) return -1;
    if (identity.st_dev != owner->store_identity.st_dev ||
        identity.st_ino != owner->store_identity.st_ino) return pd_error(ESTALE);
    /* Do not acquire/unlock the descriptor's shared open description as the
     * admission lock, including an independently opened directory alias. */
    if (identity.st_dev == descriptor->directory.st_dev &&
        identity.st_ino == descriptor->directory.st_ino) return pd_error(EINVAL);
    owner->stage = PD_SETUP_PUBLISH_FAILED; result->attempted = 1;
    if (pd_descriptor_matches_binding(descriptor, owner->binding) < 0 ||
        flock(owner->store, LOCK_EX | LOCK_NB) < 0) {
        result->error = errno; return -1;
    }
    struct pd_checkpoint checkpoint; pd_checkpoint_init(&checkpoint);
    int error = pd_admission_transition_locked(owner->store, owner->binding,
                          PD_PREPARED, PD_ADMITTED, &checkpoint) < 0 ? errno : 0;
    if (!error && pd_descriptor_matches_binding(descriptor, owner->binding) < 0) error = errno;
    if (!error && pd_checkpoint_check(owner->store, &checkpoint) < 0) error = errno;
    if (!error && pd_go_publish(&owner->pipe.sender, owner->binding, &result->delivery) < 0) error = errno;
    if (pd_checkpoint_close(&checkpoint) < 0) result->cleanup_error = errno;
    if (flock(owner->store, LOCK_UN) < 0 && !result->cleanup_error) result->cleanup_error = errno;
    if (!error) error = result->cleanup_error;
    if (error) { result->error = error; return pd_error(error); }
    owner->stage = PD_SETUP_PUBLISHED;
    return 0;
#endif
}

static void json_string(const char *s)
{
    const unsigned char *p = (const unsigned char *)s;
    putchar('"');
    for (; *p; ++p) {
        if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
        else if (*p < 0x20 || *p >= 0x7f) printf("\\u%04x", (unsigned)*p);
        else putchar(*p);
    }
    putchar('"');
}

#ifdef __linux__
/* Bounded, no-follow reads at fixed diagnostic locations. This is not a
 * supervisor-owned mount check or proof of a usable delegated domain. */
static void boot_observation(void)
{
    char b[80]; size_t used = 0; int error = 0;
    int fd = open("/proc/sys/kernel/random/boot_id", O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) error = errno;
    else {
        while (used < sizeof(b) - 1) {
            ssize_t n = read(fd, b + used, sizeof(b) - 1 - used);
            if (n < 0) { if (errno == EINTR) continue; error = errno; break; }
            if (!n) break;
            used += (size_t)n;
        }
        if (used == sizeof(b) - 1) error = EOVERFLOW;
        if (close(fd) < 0 && !error) error = errno;
    }
    b[used] = 0;
    /* UUID syntax only; validity does not authenticate this proc mount. */
    if (!error) {
        if (used != 37 || b[36] != '\n') error = EINVAL;
        for (size_t i = 0; !error && i < 36; ++i) {
            int dash = i == 8 || i == 13 || i == 18 || i == 23;
            if (dash ? b[i] != '-' : !((b[i] >= '0' && b[i] <= '9') || (b[i] >= 'a' && b[i] <= 'f'))) error = EINVAL;
        }
    }
    printf("\"boot\":{\"errno\":%d,\"value\":", error);
    if (error) fputs("null", stdout); else { b[36] = 0; json_string(b); }
    fputs("}", stdout);
}

static void cgroup_observation(void)
{
    struct stat st; struct statfs fs; int error = 0;
    int fd = open("/sys/fs/cgroup", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) error = errno;
    else if (fstat(fd, &st) < 0 || fstatfs(fd, &fs) < 0) error = errno;
    printf(",\"cgroupMount\":{\"path\":\"/sys/fs/cgroup\",\"errno\":%d", error);
    if (!error) printf(",\"cgroup2\":%s,\"device\":\"%llu\",\"inode\":\"%llu\"",
        (unsigned long)fs.f_type == 0x63677270UL ? "true" : "false",
        (unsigned long long)st.st_dev, (unsigned long long)st.st_ino);
    fputs(",\"domainAuthenticated\":false}", stdout);
    if (fd >= 0) (void)close(fd);
}

static void namespace_observations(void)
{
    const char *names[] = {"mnt", "pid", "ipc", "net", "user"};
    fputs(",\"namespaceHandles\":[", stdout);
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); ++i) {
        char path[64], value[128];
        (void)snprintf(path, sizeof(path), "/proc/self/ns/%s", names[i]);
        ssize_t n = readlink(path, value, sizeof(value) - 1);
        int error = n < 0 ? errno : (n == (ssize_t)sizeof(value) - 1 ? EOVERFLOW : 0);
        if (i) putchar(',');
        fputs("{\"name\":", stdout); json_string(names[i]);
        printf(",\"errno\":%d,\"observed\":", error);
        if (error) fputs("null", stdout); else { value[n] = 0; json_string(value); }
        fputs(",\"creationTested\":false}", stdout);
    }
    putchar(']');
}
#endif

int main(int argc, char **argv)
{
    if (argc != 2 || strcmp(argv[1], "--inspect-host") != 0) {
        fputs("PREPARATION_NATIVE_ARGUMENT_REJECTED: only --inspect-host is supported; no launch authority\n", stderr);
        return 64;
    }
    struct utsname u;
    int uname_error = uname(&u) < 0 ? errno : 0;
    fputs("{\"schemaVersion\":1,\"kind\":\"PREPARATION_NATIVE_PREFLIGHT\",\"authority\":\"NONE\","
          "\"backendAuthenticated\":false,\"workloadStarted\":false,\"capabilityProbeComplete\":false,", stdout);
#ifdef __linux__
    fputs("\"reason\":\"NATIVE_AUTHENTICATION_INCOMPLETE\",\"nativeInterfaceObservationPerformed\":true,", stdout);
#else
    fputs("\"reason\":\"UNSUPPORTED_PLATFORM\",\"nativeInterfaceObservationPerformed\":false,", stdout);
#endif
    printf("\"host\":{\"errno\":%d", uname_error);
    if (!uname_error) {
        fputs(",\"system\":", stdout); json_string(u.sysname);
        fputs(",\"release\":", stdout); json_string(u.release);
        fputs(",\"machine\":", stdout); json_string(u.machine);
    }
    fputs("},\"observations\":{", stdout);
#ifdef __linux__
    boot_observation(); cgroup_observation(); namespace_observations();
#endif
    fputs("},\"unverified\":[\"PROTECTED_SUPERVISOR\",\"AUTHORIZED_DOMAIN\",\"NAMESPACE_POLICY\","
          "\"CREDENTIAL_FD_SYSCALL_POLICY\",\"DURABLE_ADMISSION\",\"NATIVE_LAUNCH_PROTOCOL\"]}\n", stdout);
    if (fflush(stdout) == EOF || ferror(stdout)) return 74;
    return 78;
}
