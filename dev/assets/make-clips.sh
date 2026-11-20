#!/usr/bin/env bash
# Synthetic test clips for the video harness (dev/video.html). Every frame carries its index burned in twice:
# as big text and as a 12-bit code (squares at the top, LSB left) that the harness reads back from pixels.
# Run from anywhere: bash dev/assets/make-clips.sh   (needs ffmpeg with libx264 + drawtext)
set -e
cd "$(dirname "$0")"
FONT="C\:/Windows/Fonts/consolab.ttf"
bits() { local f="drawbox=x=8:y=0:w=304:h=36:color=black:t=fill"; for b in $(seq 0 11); do
  f="$f,drawbox=x=$((12+b*25)):y=8:w=20:h=20:color=white:t=fill:enable='eq(mod(floor(n/$((1<<b))),2),1)'"; done; echo "$f"; }
label() { echo "drawtext=fontfile='$FONT':text='%{frame_num}':x=w-tw-16:y=h-th-16:fontsize=72:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=8,drawtext=fontfile='$FONT':text='$1':x=16:y=h-th-16:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=6"; }
X264="-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart"
BEEP="aevalsrc='0.5*sin(2*PI*880*t)*lt(mod(t\,1)\,0.08)+0.15*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*0.25*t))':s=48000"

# name rate seconds audio(0/1) [extra filter before burn-in]
clip() { local name=$1 rate=$2 secs=$3 audio=$4 pre=${5:-null}
  local a=(); [ "$audio" = 1 ] && a=(-f lavfi -i "$BEEP" -c:a aac -b:a 96k -shortest)
  ffmpeg -y -v error -f lavfi -i "testsrc2=s=640x360:r=$rate:d=$secs" "${a[@]}" \
    -vf "$pre,$(bits),$(label "$name $rate fps")" $X264 "$name.mp4"; }

clip cfr24 24 10 1
clip cfr25 25 8 0
clip cfr2997 30000/1001 60 1
clip cfr30 30 10 0
clip cfr60 60 6 0
# drawn "on twos": the picture changes every 2nd frame, the burned-in index every frame
clip twos24 24 8 0 "fps=12,fps=24"
# variable frame rate: 60 frames at 30 fps, 30 at 10 fps, 60 at 60 fps (6 s, 150 frames)
ffmpeg -y -v error -f lavfi -i "testsrc2=s=640x360:r=30:d=5" \
  -vf "$(bits),$(label 'vfr 30/10/60'),settb=1/600,setpts='if(lt(N,60),N*20,if(lt(N,90),1200+(N-60)*60,3000+(N-90)*10))'" \
  -frames:v 150 -fps_mode passthrough -enc_time_base 1:600 -video_track_timescale 600 $X264 vfr.mp4
ls -l *.mp4
