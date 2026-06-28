Tasks for AI to work on:

# Adding Pin Feature to Game Guide
I should be able to drop a pin in a file in the guide - anywhere in the content (image, list item, paragraph, table, etc....). This creates a pin next to the page in the right TOC navigation, that when clicked moves to that page, then down to the pin. This saves my position.

I should be able to set more than one pin. eg. current position in the walkthrough, reference for a side quest, pin on a table item with my favorite weapon in the game, etc...

I should be able to list all active pins. Not sure what this looks like take a first try at it and we can iterate. Just don't muck up the existing UI with this.

# Making left nav bar collapsable
Left navigation bar should be collapsable with a button that closes it when open, and then opens it when closed. Other nav elements collapse do their icons with hover tooltip. Number pills on nav elements are hidden. Currently playing still has animation and looks nice. Information in hover tooltip.

# Adding claude/api integration so progress trackers can be auto-created

# Updating Community Features
Remove the left nav bar community live button. It's unnecessary and clutter

# Cleaning up navigable items
Some items in the website that lead to other pages are clickable to navigate, but don't behave like links (right click -> new tab). Fix these.
Make sure history is still working for all navigation on the website. Look for gaps.

# Searching Large Guides
Generating full text search and searching through large guides (Game 8) can lead to long wait times. There needs to be a compromise here.