const { RefResolver } = require('./utils/refs.js');
const { get } = require('./utils/object.js');
const { CoroutinePeekerator } = require('./utils/coroutine.js');
const { PathNode } = require('./path.js');

const buildGrammar = (path, context) => {
  const { node } = path;
  const { matchNodes, visitors } = context;
  const visitor = visitors[node.type];
  if (!visitor) {
    throw new Error(`Unknown node of {type: ${node.type}}`);
  }
  return CoroutinePeekerator.from(visitor(path, { matchNodes }));
};

// Executes token matching. Serves as a coroutine to grammar generators.
// Takes tokens from `source` and puts them in `matchNode.cstTokens`
// `node` is an AST node that acts as the "pattern" to match
// `grammar` defines which tokens can belong to a given `node`
// `source` could be either flat text or a CST
const __exec = (path, source, context) => {
  const { node } = path;
  const { matchNodes } = context;
  const cstTokens = [];

  const matchNode = {
    node,
    cstTokens,
    source: {
      // This is as much of the source as I dare make public to the grammar
      type: source.type,
      start: undefined,
      end: undefined,
    },
  };
  const grammar = buildGrammar(path, context);
  let resolver = new RefResolver(node);

  matchNode.source.start = source.index;

  while (!grammar.done) {
    // The grammar generator has just yielded a command
    const command = grammar.value;
    const { type, value } = command;

    if (type === 'emit') {
      cstTokens.push(...value);
    } else {
      const descriptors = value;
      const forkedResolver = resolver.fork();
      let { separatorMatch, separatorDescriptor } = context;
      let match_ = [];

      for (const descriptor of descriptors) {
        // Capture any trailing separator tokens that have bubbled up
        if (separatorMatch != null) {
          match_.push(...separatorMatch);
          context.separatorMatch = separatorMatch = null;
          context.separatorDescriptor = separatorDescriptor = null;
        }

        if (descriptor.type === 'Reference') {
          const tokens = source.match(descriptor);
          const refToken = tokens[0];
          const path = forkedResolver.resolve(refToken);
          const child = get(node, path);
          const childSource = source.fork(child);

          // Ensure that any separator tokens at the beginning of the child end up in the parent

          if (separatorDescriptor) {
            // I am assuming that matching this descriptor twice in a row is safe
            const submatch = childSource.match(separatorDescriptor);
            if (submatch) {
              childSource.advance(submatch);
              match_.push(...submatch);
            }
          }

          // Recurse!
          const tree = __exec(new PathNode(child, path), childSource, context);
          // Done recursing. Yay!

          ({ separatorMatch, separatorDescriptor } = context);

          // Any separator tokens at the end of `child` are now in `context.separatorMatch`
          // They will bubble up and be emitted by the next parent which isn't finished

          match_.push(refToken);
          matchNodes.set(refToken, tree);
          source.advance(tokens, matchNodes);
        } else {
          const submatch = source.match(descriptor);
          if (submatch) {
            if (descriptor.type === 'Separator') {
              // Wait to emit these tokens until we know if they are between nodes
              context.separatorMatch = separatorMatch = submatch;
              context.separatorDescriptor = separatorDescriptor = descriptor;
            } else {
              match_.push(...submatch);
            }
            source.advance(submatch, matchNodes);
          } else {
            match_ = null;
          }
        }

        if (!match_) break;
      }

      if (match_) {
        resolver = forkedResolver;
      }

      if (type === 'match') {
        // Feeds matching tokens to the grammar generator. In the grammar it looks like:
        // cstTokens = yield match(...descriptors);
        grammar.advance(match_);
        continue;
      } else if (type === 'take') {
        if (match_) {
          cstTokens.push(...match_);
        } else {
          let fallbackSource;
          try {
            fallbackSource = source.fallback();
          } catch (e) {
            const cause = command.error;
            throw new Error('Parsing failed', cause && { cause });
          }
          return __exec(path, fallbackSource, context);
        }
      } else {
        throw new Error(`Unknown {type: ${type}}`);
      }
    }

    // Continue executing the grammar generator
    grammar.advance();
  }

  matchNode.source.end = source.index;

  return matchNode;
};

const exec = (node, source, context = buildContext()) => {
  const path = new PathNode(node, null);

  const result = __exec(path, source, context);

  if (context.separatorMatch) {
    result.cstTokens.push(...context.separatorMatch);
    context.separatorMatch = null;
  }

  return result;
};

const buildContext = (visitors) => ({
  visitors,
  matchNodes: new WeakMap(),
  separatorMatch: null,
  separatorDescriptor: null,
});

module.exports = { exec, buildContext };
