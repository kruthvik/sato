# Sato

Sato is a learning engine built as a fork of [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), utilizing mainstream learning research.

> **Note:** This is my personal implementation. The current setup may not work best for everyone, so use your own judgment and discretion when adapting it.

## Current Implementation

The current version uses extension and skill injection into existing pi-agent downloads to separate global and local instances. Back up pi-agent and the current setup in case of failure, and verify the integration before relying on it.

Sato also includes various integrations and add-ons, with more likely to come in the future.

## Development Notes

A large portion of this application features AI-generated and AI-assisted code. While the core system design and setup were personally created, much of the internal structure and the extensions and skills were not.

I plan to add a real fork of the agent that can be used globally, so injection will no longer be required. I am currently vetting this fork and verifying that all features work correctly.


## Credits
The idea and inspiration for the overall system comes from https://www.youtube.com/watch?v=kzcI5F4tGiU&list=WL&index=10 and his other videos. While this program greatly expands on his work, it also takes great influence from his content. 

The research notes should also still be present in the program with apt citations. If any other issues with credit are present, please let me know and I will address them.
