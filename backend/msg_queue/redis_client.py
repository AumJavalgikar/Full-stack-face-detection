import redis


class RedisClient:
    _instances = {}

    def __new__(cls, *args, **kwargs):
        key = (
            kwargs.get("host", "localhost"),
            kwargs.get("port", 6379),
            kwargs.get("db", 0),
            kwargs.get("password", None),
            kwargs.get("max_connections", 50),
            kwargs.get("decode_responses", True),
        )
        if key not in cls._instances:
            instance = super().__new__(cls)
            instance._initialize(*args, **kwargs)
            cls._instances[key] = instance
        return cls._instances[key]

    def _initialize(
        self,
        host="localhost",
        port=6379,
        db=0,
        password=None,
        max_connections=50,
        decode_responses=True,
    ):
        self._pool = redis.ConnectionPool(
            host=host,
            port=port,
            db=db,
            password=password,
            max_connections=max_connections,
            decode_responses=decode_responses,
        )

    def get_client(self):
        return redis.Redis(connection_pool=self._pool)