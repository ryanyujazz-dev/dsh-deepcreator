# @ryanyujazz/dsh-client-presentation

React-free client-side Presentation Runtime. It advertises presenter capabilities, atomically claims compatible Host requests, fences acknowledgements by `clientId`, and coordinates dismissal tombstones. UI packages register independent resource presenters. Its `open(input)` method is the public path for explicit user UI actions: it asks Host Presentation to materialize the resource and then lets the ordinary claim loop present and acknowledge it, rather than letting feature UI call Browser or Workbench internals.
