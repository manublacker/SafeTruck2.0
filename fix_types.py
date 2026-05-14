import numpy as np
import psycopg2.extensions

# Registrar adaptadores para tipos numpy
psycopg2.extensions.register_adapter(np.float64, lambda x: psycopg2.extensions.AsIs(float(x)))
psycopg2.extensions.register_adapter(np.int64, lambda x: psycopg2.extensions.AsIs(int(x)))
psycopg2.extensions.register_adapter(np.bool_, lambda x: psycopg2.extensions.AsIs(bool(x)))
