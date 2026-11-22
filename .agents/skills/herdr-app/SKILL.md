---
name: herdr-app
description: "Use when a terminal or agent must appear in the person's Herdr window: opening the space, tab or split it runs in; labelling an hc terminal so the window adopts it; peeking at or keeping a sub-agent that has no pane; bringing one back with show, focus or pin; and reading the window with herdr-app ls and status. Starting, messaging, waiting on and cleaning up the agents themselves is the herdr-core skill."
---

# herdr-app: make a started agent visible

The window shows spaces, tabs and panes. herdr-core (`hc`) runs the
terminals inside them and keeps them alive when the window closes. A
terminal shows up in the window only when something places it there: an app
command, or a label the window adopts. This skill is that placing.

The window's own look — layouts, keys, mods, themes — belongs to the person.

## Inspect

```sh
herdr-app ls          # spaces > tabs > terminals, with pane IDs
herdr-app status      # shown layout, focus, overlays, zoom, and file/mod errors
herdr-app commands    # every command, its arguments, what it does
```

`ls` and `status` read the running window; `commands` prints with no window
open too. Bare `herdr-app` opens and raises the window, so inspect with
these three.

Closing the window costs nothing: the core holds the terminals. Stopping or
restarting the app or the core ends what they run.

## Open a place for the agent

```sh
herdr-app do space.new --name api --folder /path/to/api
herdr-app do tab.new --name "fix login" --argv '["claude"]' --task "Look at the login bug"
herdr-app do pane.split --direction right --pane p12 --argv '["pi"]'
```

A new space or tab shows at once, on the person's screen. Create one where
the person asked to see the agent; one that works unseen belongs to `hc`
alone.

Name every space and tab, and reach them by the IDs `ls` reports.

`do` returns the IDs it made: the place exists, which is not the same as the
program running. `ls` confirms the terminal and `status` its errors; a
program that exits nonzero within two seconds also raises a toast with its
exit code and last lines.

A remote space names its machine and a folder there, and its tabs and splits
stay on that machine:

```sh
herdr-app do space.new --name "remote api" --machine vps --folder /srv/api
```

Script commands without `--machine` use this computer; `--machine ''` says
so on purpose. Remote work goes through `hc run --on`, `hc exec --on` and
`hc file ... --on`: local file tools reach only this machine.

## Adopt a terminal you already started

A terminal carrying `herdr.space=<id>` shows in that space, and Herdr's own
`space.new` and `tab.new` label their terminals this way.

```sh
hc run --bg --label herdr.space=<space id> --label herdr.tab=<tab id> -- claude
hc label t7 herdr.space=<space id>
```

Ids are local to the terminal's machine, so drop the `machine/` prefix the
window displays. Without `herdr.tab`, the window opens a new tab for it.
Adoption also turns on core keep, so the terminal survives the window;
`terminal.park` removes the pane and turns that off again.

An unlabeled terminal stays out of the window, which is what a background
worker wants — label the ones the person should watch.

## Sub-agents have no pane

A terminal started with `hc run` hangs under its parent's tab without a pane
of its own.

- `terminal.peek {terminal}` looks at it over the current tab, with
  keep-as-tab and close offered there.
- `terminal.keep {terminal}` gives it a pane that stays.
- `terminal.show {terminal}` brings it into view; `pane.focus {terminal}` and
  `agent.focus {terminal}` move the keyboard there.
- `terminal.pin {terminal, pinned: true}` floats it to the top of the agent
  lists.

Your own address is `$HC_TERMINAL_ID`, not a pane ID.

## Which command shows what

| Want | Command |
|---|---|
| An agent in a new space | `space.new {name, folder, argv, task, machine}` |
| An agent in a new tab | `tab.new {name, space, argv, task}` |
| An agent beside a pane | `pane.split {direction, pane, argv}` |
| A terminal in a tab or split | `terminal.open {argv, folder, place}` |
| A sub-agent on screen | `terminal.peek`, `terminal.keep`, `terminal.show` |
| Back to an agent | `agent.focus`, `agent.next`, `agent.prev`, `terminal.pin` |
| A specific pane's keyboard | `pane.focus {pane \| terminal}` |

## `do` arguments

`--key value` pairs with arrays and objects as JSON, or one JSON object:
`herdr-app do pane.split '{"direction":"right","pane":"p12"}'`.

Unknown argument names fail and list the valid ones; they never fall back to
the current target. Target ids (`id`, `pane`, `space`, `terminal`) are
strings, and another non-null type fails before a default can apply. `null`
means omitted. A failure prints `{"error": "..."}` and exits 1. A command an
agent runs never opens a missing-argument dialog, so pass every required
argument.

`herdr-app feedback "<what happened>"` drafts a report for the person to
review and send.
