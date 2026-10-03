#!/usr/bin/env bash
# Restart the render box cleanly: stop both user services, end any shell-launched ComfyUI still holding :8188,
# bring ComfyUI up under systemd, wait for its API, then bring the job server up. The job queue is persisted
# (~/.cache/cue-render/jobs.json): a job that was mid-render goes back to the front of the line.
# Usage: render/restart-box.sh
set -u
systemctl --user stop cue-render comfyui 2>/dev/null
for pid in $(pgrep -f 'main.py --listen 127.0.0.1 --port 8188'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done
for i in $(seq 1 20); do pgrep -f 'main.py --listen 127.0.0.1 --port 8188' >/dev/null || break; sleep 1; done
systemctl --user reset-failed comfyui cue-render 2>/dev/null
systemctl --user start comfyui
for i in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:8188/system_stats && break; sleep 3; done
curl -sf http://127.0.0.1:8188/object_info/CueDMDSigmas >/dev/null && echo "ComfyUI up, CUE sigma node loaded" || echo "WARNING: ComfyUI API not answering or CueDMDSigmas missing (copy render/comfy_custom_nodes/cue_dmd_sigmas.py into ComfyUI/custom_nodes)"
systemctl --user start cue-render
sleep 3
systemctl --user is-active comfyui cue-render
TOK=$(sed -n 's/^CUE_RENDER_TOKEN=//p' ~/.config/cue-render/env)
curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:8790/health; echo
