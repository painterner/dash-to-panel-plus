import json
import os
import sys
from pathlib import Path
Path(os.environ['DTPP_TEST_OUTPUT'], 'argv.json').write_text(json.dumps(sys.argv[1:]))
