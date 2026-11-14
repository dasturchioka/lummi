import { configure } from '@testing-library/react';

// CI runners are several times slower than a laptop: the first render of a lazy screen can take
// over a second there (HeartButton flaked at 1.5 s on 7690d29). `findBy*` / `waitFor` wait this
// long before failing; a passing test returns as soon as its element appears.
configure({ asyncUtilTimeout: 5000 });
