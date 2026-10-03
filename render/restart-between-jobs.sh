#!/usr/bin/env bash
# Restart the job server between jobs, so nothing mid-render is thrown away: waits for the running job to finish
# (polls jobs.json), then restarts cue-render. ComfyUI is left alone. Usage: render/restart-between-jobs.sh
set -u
J=~/.cache/cue-render/jobs.json
for i in $(seq 1 240); do   # up to 2 h
  running=$(python3 -c "import json;d=json.load(open('$J'));print(sum(1 for j in d['jobs'].values() if j['status']=='running'))" 2>/dev/null || echo 0)
  [ "$running" = "0" ] && break
  sleep 30
done
systemctl --user restart cue-render
sleep 3
systemctl --user is-active cue-render
TOK=$(sed -n 's/^CUE_RENDER_TOKEN=//p' ~/.config/cue-render/env)
curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:8790/health; echo
