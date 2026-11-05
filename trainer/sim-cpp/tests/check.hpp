// Minimal test helper (no framework dependency). Each failed check prints and the run exits non-zero.
#pragma once

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace check {

inline int& failures() {
  static int n = 0;
  return n;
}

struct Case {
  const char* name;
  std::function<void()> fn;
};

inline std::vector<Case>& cases() {
  static std::vector<Case> c;
  return c;
}

struct Register {
  Register(const char* name, std::function<void()> fn) { cases().push_back({name, std::move(fn)}); }
};

inline int run() {
  int failedCases = 0;
  for (auto& c : cases()) {
    const int before = failures();
    c.fn();
    const bool ok = failures() == before;
    if (!ok) failedCases++;
    std::printf("%s %s\n", ok ? "  ok  " : "  FAIL", c.name);
  }
  std::printf("%zu cases, %d failed\n", cases().size(), failedCases);
  return failedCases ? 1 : 0;
}

}  // namespace check

#define CHECK_CAT2(a, b) a##b
#define CHECK_CAT(a, b) CHECK_CAT2(a, b)
#define TEST(name)                                                                  \
  static void CHECK_CAT(test_, __LINE__)();                                         \
  static check::Register CHECK_CAT(reg_, __LINE__)(name, CHECK_CAT(test_, __LINE__)); \
  static void CHECK_CAT(test_, __LINE__)()

#define CHECK(cond)                                                       \
  do {                                                                    \
    if (!(cond)) {                                                        \
      check::failures()++;                                                \
      std::printf("    %s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #cond); \
    }                                                                     \
  } while (0)

#define CHECK_NEAR(a, b, tol)                                                                              \
  do {                                                                                                     \
    const double va_ = (a), vb_ = (b);                                                                     \
    if (!(std::fabs(va_ - vb_) <= (tol))) {                                                                \
      check::failures()++;                                                                                 \
      std::printf("    %s:%d: %s = %.17g, expected %.17g (tol %g)\n", __FILE__, __LINE__, #a, va_, vb_, (double)(tol)); \
    }                                                                                                      \
  } while (0)
