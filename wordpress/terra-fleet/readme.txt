=== Terra Fleet ===
Contributors: terra
Tags: logistics, headless, leaderboard, simulation
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 1.0.0
License: MIT

Connects WordPress to the Terra logistics sim.

== Description ==

* **Headless CMS for the app.** Posts are "Dispatches"; each has a `terra_issue` number exposed on the REST API. The Terra API reads `/wp-json/wp/v2/posts` and the app's landing page shows the latest three.
* **Shortcodes.** `[terra_leaderboard take="10"]`, `[terra_network]` and `[terra_play label="Play Terra" path="/city"]` render live data from the Terra API, cached with transients.
* **REST proxy.** `GET /wp-json/terra/v1/leaderboard?take=10`.
* **Daily Dispatch.** The Azure Function `dailyDispatch` drafts a new post every morning using an application password.

== Installation ==

1. Copy `terra-fleet` to `wp-content/plugins` (Docker Compose mounts it for you).
2. Activate it, then set the API and app URLs under Settings → Terra Fleet.
