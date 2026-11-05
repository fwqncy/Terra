/*
 * Terra headless car simulation: C interface.
 *
 * A world holds exported routes (tools/export-trainer-worlds.mjs). Brains are flat double arrays in the
 * order shared with the Python trainer: for each level, weights row-major [input][output], then biases.
 * Two ways to drive cars:
 *   - terra_run_episodes: every (brain, task) pair runs a full Bootcamp episode, in parallel threads.
 *   - terra_batch_*:      a batch of cars stepped frame by frame, by their own brains or by external actions.
 * Functions returning int return 0 on success and a negative value on bad arguments.
 */
#ifndef TERRA_SIM_H
#define TERRA_SIM_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct terra_world terra_world;
typedef struct terra_batch terra_batch;

/* Outcomes, as in terra_episode.outcome */
#define TERRA_STALLED 0
#define TERRA_CRASHED 1
#define TERRA_ARRIVED 2
#define TERRA_OUT_OF_TIME 3

typedef struct {
  double score;          /* Bootcamp score: progress fraction, or 1 + time bonus when arrived */
  double progress;       /* best progress along the route, in world units */
  double x, y;           /* final position (the crash site for crashes) */
  int32_t age;           /* frames driven */
  int32_t outcome;       /* TERRA_* */
  int32_t route_index;   /* route polyline segment the car ended on */
  int32_t graph_segment; /* map graph segment under that route segment, or -1 */
  int32_t task;
  int32_t map;
} terra_episode;

/* ---- worlds ---- */
/* `json` is one exported world document or an array of them. On failure returns NULL and writes `err`. */
terra_world* terra_create_world(const char* json, char* err, size_t err_len);
int terra_world_append(terra_world* world, const char* json, char* err, size_t err_len);
int terra_task_count(const terra_world* world);
int terra_param_count(const terra_world* world);
int terra_obs_size(const terra_world* world);
/* Task metadata: holdout flag and route length (world units). */
int terra_task_info(const terra_world* world, int task, int32_t* holdout, double* route_length, int32_t* map);
void terra_destroy_world(terra_world* world);

/* ---- whole episodes ---- */
/* out has n_brains * n_tasks entries, brain-major. threads <= 0 uses every core. */
int terra_run_episodes(const terra_world* world, const double* params, int n_brains, const int32_t* tasks, int n_tasks, int threads,
                       terra_episode* out);

/* ---- batches ---- */
terra_batch* terra_create_batch(const terra_world* world, int n_cars, const int32_t* tasks, int threads);
int terra_batch_size(const terra_batch* batch);
/* n_brains is 1 (every car shares it) or n_cars. Without brains, cars need external actions. */
int terra_set_brains(terra_batch* batch, const double* params, int n_brains);
/* Puts every car back on its start; `tasks` (n_cars, nullable) reassigns them. */
int terra_reset(terra_batch* batch, const int32_t* tasks);
/*
 * Advances `steps` frames. `actions` (nullable) is n_cars * 4 bytes (forward, left, right, reverse),
 * held for every frame of the call; NULL lets each car's brain drive. `rewards` (nullable) receives the
 * per-car score gained, so an episode's rewards sum to its Bootcamp score. `dones` (nullable) is set to 1
 * for cars whose episode ended; those cars restart on their task and terra_last_episode describes the run.
 */
int terra_step_batch(terra_batch* batch, int steps, const uint8_t* actions, double* rewards, uint8_t* dones);
/* n_cars * obs_size network inputs: 7 ray sensors, route bearing, speed, lane offset. */
int terra_get_observations(const terra_batch* batch, double* out);
/* n_cars * 6: x, y, angle, speed, best progress, age. */
int terra_get_states(const terra_batch* batch, double* out);
int terra_last_episode(const terra_batch* batch, int car, terra_episode* out);
void terra_destroy(terra_batch* batch);

#ifdef __cplusplus
}
#endif

#endif /* TERRA_SIM_H */
