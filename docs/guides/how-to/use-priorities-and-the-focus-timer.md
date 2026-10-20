# How to plan tasks and run the focus timer

This recipe shows how to set a priority and an expected number of
Pomodoros on a task, run a timer against it, and read your progress.

## Prerequisites

- A running FocusFlow instance and an account (see
  [self-host with Docker Compose](self-host-with-docker-compose.md)).

## Steps

1. **Create a task with a priority and an expected effort.** On the Tasks
   screen, fill in the title, choose a **Priority** (high, medium, or low;
   new tasks default to medium) and **Expected Pomodoros** (1 to 20;
   default 1), then add the task.

2. **Read your progress.** Each task shows `Pomodoros: completed/expected`,
   for example `2/4`. A Pomodoro counts as completed only when a full
   25-minute work phase ends.

3. **Start a timer.** Press **Start** on a task. You land on the Focus
   view, which shows a circular countdown, the phase (work or break), the
   task title, and `Pomodoro n of 4`. On the Tasks screen the running task
   is marked **In progress**.

4. **Let the phase finish.** When a work phase ends the server records the
   Pomodoro and a break begins automatically: 5 minutes, or 15 minutes after
   every 4th completed Pomodoro. When a break ends the timer stops; press
   **Start** on a task to begin the next Pomodoro.

5. **Stop or skip.** During work, **Stop** ends the timer and the
   unfinished Pomodoro is discarded: it is not recorded and does not
   count. During a break the button reads **Skip break** and ends the
   timer.

## Things to know

- **One timer at a time.** While a timer is running (work or break), every
  other task's **Start** is disabled and the screen names the running task.
- **Reload or open a second tab.** The countdown runs on the server, so
  the Focus view shows the same time remaining everywhere. Time continues
  to pass while the page is closed; a phase that ended in the meantime is
  recorded the next time you open Tasks, Focus, or Analytics.
- **Shorter intervals for testing.** Setting `POMODORO_TEST_SHORT_INTERVALS`
  to any non-empty value in `.env` shortens the phases to 60 seconds of
  work, 15 seconds of short break, and 30 seconds of long break. The api
  service reads it. Leave it empty in a real deployment, as the
  [self-hosting guide](self-host-with-docker-compose.md) says.

For the canonical values and behavior, see
[the feature spec](../../specs/task-priority-focus-timer/spec.md).
